import {
  HttpException,
  Injectable,
  Logger,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, mkdir, opendir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Request, Response } from 'express';
import { lastValueFrom, of, type Observable } from 'rxjs';
import {
  SAVE_ERRORS,
  SaveInputError,
  type SaveErrorCode,
} from '../hoi4/save-input.error';
import {
  MAX_MULTIPART_OVERHEAD_BYTES,
  MAX_STARTUP_CLEANUP_ENTRIES,
  UPLOAD_STALE_MS,
  sanitizeSaveFileName,
  saveUploadPolicy,
} from '../hoi4/save-upload.policy';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import { ProductEventsService } from '../telemetry/product-events.service';
import type {
  AnalysisAttemptContext,
  AnalysisFailureProperties,
  AnalysisTelemetryCarrier,
  ProductAnalysisErrorCode,
} from '../telemetry/product-events.types';

interface UploadSession {
  path?: string;
  owned: boolean;
  writer?: Promise<void>;
  stream?: Readable;
  receiving: boolean;
  abort: (error: Error) => void;
  done: Promise<void>;
}

/** Owns admission and the complete multipart lifetime, including failures before the controller. */
@Injectable()
export class SaveUploadInterceptor
  implements NestInterceptor, OnModuleInit, OnModuleDestroy
{
  readonly policy = saveUploadPolicy();
  readonly directory = resolve(
    process.env.HOI4_UPLOAD_DIRECTORY || join(tmpdir(), 'hoi4-save-tracker'),
  );
  private readonly logger = new Logger(SaveUploadInterceptor.name);
  private readonly sessions = new Set<UploadSession>();
  private closing = false;
  private ready = false;
  private warnedCleanup = false;

  constructor(private readonly telemetry: ProductEventsService) {}

  async onModuleInit() {
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const stat = await lstat(this.directory);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Unsafe upload directory');
      this.ready = true;
      await this.cleanupStale();
    } catch {
      this.warnCleanup();
    }
  }

  async cleanupStale() {
    try {
      const directory = await opendir(this.directory);
      const staleAge = Math.max(
        UPLOAD_STALE_MS,
        this.policy.uploadTimeoutMs + this.policy.analysisTimeoutMs + 3600_000,
      );
      let inspected = 0;
      for await (const entry of directory) {
        if (++inspected > MAX_STARTUP_CLEANUP_ENTRIES) break;
        if (
          !/^upload-\d+-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.hoi4$/.test(
            entry.name,
          ) ||
          !entry.isFile()
        )
          continue;
        const filePath = join(this.directory, entry.name);
        const stat = await lstat(filePath);
        if (
          stat.isFile() &&
          !stat.isSymbolicLink() &&
          Date.now() - stat.mtimeMs > staleAge
        )
          await unlink(filePath);
      }
    } catch {
      this.warnCleanup();
    }
  }

  private warnCleanup() {
    if (!this.warnedCleanup) {
      this.warnedCleanup = true;
      this.logger.warn(
        'Could not manage temporary save uploads; check storage permissions and free space.',
      );
    }
  }

  private async remove(session: UploadSession) {
    // `wx` protects against collisions. Only unlink after the stream confirms
    // that this request actually created the file.
    if (!session.path || !session.owned) return;
    try {
      await unlink(session.path);
      session.owned = false;
      session.path = undefined;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        session.owned = false;
        session.path = undefined;
      } else {
        this.warnCleanup();
      }
    }
  }

  private exception(error: unknown): HttpException {
    let code: SaveErrorCode = 'ANALYSIS_FAILED';
    if (error instanceof SaveInputError) code = error.code;
    else if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === 413) code = 'FILE_TOO_LARGE';
      else if (status === 503) code = 'ANALYZER_BUSY';
      else if (status === 400) code = 'INVALID_SAVE';
      else if (status === 404)
        return new HttpException(
          {
            code: 'SAVE_NOT_FOUND',
            message: 'The selected local save is unavailable.',
          },
          404,
        );
    }
    if (code === 'ANALYSIS_FAILED')
      this.logger.error(
        'Save analysis failed unexpectedly. Check server diagnostics and resource limits.',
      );
    const [status, message] = SAVE_ERRORS[code];
    return new HttpException(
      {
        code,
        message,
        ...(code === 'FILE_TOO_LARGE'
          ? { maxUploadBytes: this.policy.maxUploadBytes }
          : {}),
      },
      status,
    );
  }

  private errorCode(error: HttpException): ProductAnalysisErrorCode {
    const response = error.getResponse();
    if (response && typeof response === 'object' && 'code' in response) {
      const code = response.code;
      if (
        code === 'SAVE_NOT_FOUND' ||
        (typeof code === 'string' && Object.hasOwn(SAVE_ERRORS, code))
      )
        return code as ProductAnalysisErrorCode;
    }
    return 'ANALYSIS_FAILED';
  }

  private async recordTerminal(
    attempt: AnalysisAttemptContext,
    error: HttpException,
  ): Promise<void> {
    if (attempt.terminalRecorded) return;
    attempt.terminalRecorded = true;
    const properties: AnalysisFailureProperties = {
      errorCode: this.errorCode(error),
      failureStage: attempt.stage,
      ...(attempt.fileSizeBytes === undefined
        ? {}
        : { fileSizeBytes: attempt.fileSizeBytes }),
      ...(attempt.saveFormat === undefined
        ? {}
        : { saveFormat: attempt.saveFormat }),
    };
    if (
      ['ANALYSIS_FAILED', 'ANALYSIS_TIMEOUT', 'PERSISTENCE_FAILED'].includes(
        properties.errorCode,
      )
    )
      await this.telemetry.recordFailed(attempt, properties);
    else await this.telemetry.recordRejected(attempt, properties);
  }

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest & AnalysisTelemetryCarrier>();
    const response = context.switchToHttp().getResponse<Response>();
    const attempt: AnalysisAttemptContext = {
      flowId: randomUUID(),
      userId: request.user?.id ?? null,
      startedAtMs: Date.now(),
      stage: 'admission',
      terminalRecorded: false,
    };
    request.productAnalysisAttempt = attempt;
    await this.telemetry.recordStarted(attempt);
    const multipart = request.is('multipart/form-data');
    const closeRejectedBody = () => {
      if (!multipart || request.readableEnded || response.headersSent) return;
      response.shouldKeepAlive = false;
      response.setHeader('Connection', 'close');
      response.once('finish', () => request.destroy());
    };
    if (
      this.closing ||
      this.sessions.size >= this.policy.maxConcurrentRequests
    ) {
      closeRejectedBody();
      const error = this.exception(new SaveInputError('ANALYZER_BUSY'));
      await this.recordTerminal(attempt, error);
      throw error;
    }
    const maxBody = this.policy.maxUploadBytes + MAX_MULTIPART_OVERHEAD_BYTES;
    if (multipart && Number(request.headers['content-length']) > maxBody) {
      closeRejectedBody();
      const error = this.exception(new SaveInputError('FILE_TOO_LARGE'));
      await this.recordTerminal(attempt, error);
      throw error;
    }
    attempt.stage = 'upload';
    let settle!: () => void;
    let rejectUpload!: (error: Error) => void;
    const failure = new Promise<never>((_resolve, reject) => {
      rejectUpload = reject;
    });
    void failure.catch(() => {}); // Also handle aborts during setup before Promise.race is attached.
    const session: UploadSession = {
      owned: false,
      receiving: true,
      done: new Promise<void>((resolve) => {
        settle = resolve;
      }),
      abort: (error) => {
        if (!session.receiving) return;
        session.receiving = false;
        closeRejectedBody();
        request.unpipe();
        request.pause();
        session.stream?.destroy(error);
        rejectUpload(error);
      },
    };
    this.sessions.add(session);
    let received = 0;
    const onData = (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBody)
        session.abort(new SaveInputError('FILE_TOO_LARGE'));
    };
    const onAbort = () => session.abort(new SaveInputError('INVALID_SAVE'));
    const timeout = multipart
      ? setTimeout(
          () => session.abort(new SaveInputError('UPLOAD_TIMEOUT')),
          this.policy.uploadTimeoutMs,
        )
      : undefined;
    timeout?.unref();
    if (multipart) {
      request.on('data', onData);
      request.once('aborted', onAbort);
      request.once('error', onAbort);
    }
    let uploadComplete = false;
    try {
      if (!this.ready) throw new SaveInputError('ANALYSIS_FAILED');
      const Upload = FileInterceptor('file', {
        defParamCharset: 'utf8',
        limits: {
          fileSize: this.policy.maxUploadBytes,
          files: 1,
          fields: 1,
          parts: 2,
          fieldSize: 4096,
          fieldNameSize: 64,
          headerPairs: 32,
        },
        fileFilter: (_req, file, callback) => {
          file.originalname = sanitizeSaveFileName(file.originalname);
          if (!/^.+\.hoi4$/i.test(file.originalname)) {
            const error = new SaveInputError('UNSUPPORTED_FILE_TYPE');
            session.abort(error);
            callback(error, false);
          } else callback(null, true);
        },
        storage: {
          _handleFile: (
            _req: Request,
            file: { stream: Readable },
            callback: (
              error: Error | null,
              info?: { path: string; size: number },
            ) => void,
          ) => {
            if (!session.receiving) {
              callback(new SaveInputError('INVALID_SAVE'));
              return;
            }
            const filePath = join(
              this.directory,
              `upload-${process.pid}-${randomUUID()}.hoi4`,
            );
            session.path = filePath;
            session.stream = file.stream;
            file.stream.once('limit', () =>
              session.abort(new SaveInputError('FILE_TOO_LARGE')),
            );
            const output = createWriteStream(filePath, {
              flags: 'wx',
              mode: 0o600,
            });
            output.once('open', () => {
              session.owned = true;
            });
            session.writer = pipeline(file.stream, output).then(
              () =>
                callback(null, { path: filePath, size: output.bytesWritten }),
              (error: unknown) =>
                callback(
                  error instanceof Error ? error : new Error('Upload failed'),
                ),
            );
          },
          _removeFile: (
            _req: Request,
            _file: unknown,
            callback: (error: Error | null) => void,
          ) => {
            void this.remove(session).then(() => callback(null));
          },
        },
      });
      const delegate = new Upload();
      const stream = await Promise.race([
        delegate.intercept(context, next),
        failure,
      ]);
      uploadComplete = true;
      session.receiving = false;
      clearTimeout(timeout);
      // Await shared analysis even after disconnect: never delete the leader's file early.
      const value: unknown = await lastValueFrom(stream as Observable<unknown>);
      attempt.terminalRecorded = true;
      await this.telemetry.recordCompleted(attempt, {
        totalDurationMs: Math.max(0, Date.now() - attempt.startedAtMs),
      });
      return of(value);
    } catch (error) {
      closeRejectedBody();
      // Busboy syntax failures are expected invalid input; storage errors remain server failures.
      let failure: HttpException;
      if (
        !uploadComplete &&
        !(error instanceof HttpException) &&
        !(error instanceof SaveInputError) &&
        !(error && typeof error === 'object' && 'code' in error)
      )
        failure = this.exception(new SaveInputError('INVALID_SAVE'));
      else failure = this.exception(error);
      await this.recordTerminal(attempt, failure);
      throw failure;
    } finally {
      clearTimeout(timeout);
      request.off('data', onData);
      request.off('aborted', onAbort);
      request.off('error', onAbort);
      session.receiving = false;
      await session.writer?.catch(() => this.warnCleanup());
      await this.remove(session);
      this.sessions.delete(session);
      settle();
    }
  }

  async onModuleDestroy() {
    this.closing = true;
    const sessions = [...this.sessions];
    for (const session of sessions)
      session.abort(new SaveInputError('ANALYZER_BUSY'));
    await Promise.all(sessions.map((session) => session.done));
  }
}
