import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

const phaseNames = [
  'admissionMs',
  'multipartMs',
  'validationMs',
  'sha256Ms',
  'cacheLookupMs',
  'sharedAnalysisWaitMs',
  'workerAdmissionMs',
  'workerMs',
  'parserMs',
  'workerOutsideParserMs',
  'artifactLoadMs',
  'artifactQueueWaitMs',
  'artifactPersistenceMs',
  'artifactSerializationMs',
  'artifactCompressionMs',
  'historyQueueWaitMs',
  'historyMetadataMs',
  'ownershipDatabaseMs',
  'persistenceMs',
  'telemetryMs',
  'responsePreparationMs',
] as const;
type Phase = (typeof phaseNames)[number];

export class AnalyzeRequestProfile {
  readonly requestId = randomUUID().replaceAll('-', '').slice(0, 12);
  readonly startedAt = performance.now();
  readonly phases = Object.fromEntries(
    phaseNames.map((name) => [name, null]),
  ) as Record<Phase, number | null>;
  fileBytes: number | null = null;
  hashPrefix: string | null = null;
  cacheHit: boolean | null = null;
  cacheStatus: 'hit' | 'miss' | 'in_flight' | null = null;
  multipartCompleteMs: number | null = null;
  errorCode: string | null = null;
  private finished = false;

  begin(phase: Phase): () => void {
    const start = performance.now();
    let ended = false;
    return () => {
      if (ended || this.finished) return;
      ended = true;
      this.phases[phase] =
        (this.phases[phase] ?? 0) + performance.now() - start;
    };
  }

  multipartComplete(): void {
    this.multipartCompleteMs = performance.now() - this.startedAt;
    this.phases.multipartMs = this.multipartCompleteMs;
  }

  workerCompleted(parseSeconds: number): void {
    if (!Number.isFinite(parseSeconds) || parseSeconds < 0) return;
    this.phases.parserMs = parseSeconds * 1000;
    if (this.phases.workerMs !== null)
      this.phases.workerOutsideParserMs = Math.max(
        0,
        this.phases.workerMs - this.phases.parserMs,
      );
  }

  finish(response: Response, completed: boolean): void {
    if (this.finished) return;
    this.finished = true;
    const elapsed = performance.now() - this.startedAt;
    const length = response.getHeader('content-length');
    const bytes =
      typeof length === 'number'
        ? length
        : typeof length === 'string' && /^\d+$/.test(length)
          ? Number(length)
          : null;
    const round = (value: number | null) =>
      value === null ? null : Math.round(value * 10) / 10;
    const summary = {
      requestId: this.requestId,
      requestEnteredMs: 0,
      multipartCompleteMs: round(this.multipartCompleteMs),
      fileBytes: this.fileBytes,
      hashPrefix: this.hashPrefix,
      cacheHit: this.cacheHit,
      cacheStatus: this.cacheStatus,
      phases: Object.fromEntries(
        phaseNames.map((name) => [name, round(this.phases[name])]),
      ),
      responseFinishedMs: completed ? round(elapsed) : null,
      backendTotalMs: round(elapsed),
      responseBytes:
        bytes !== null && Number.isSafeInteger(bytes) && bytes >= 0
          ? bytes
          : null,
      statusCode: response.statusCode,
      outcome: !completed
        ? 'aborted'
        : response.statusCode >= 400
          ? 'failed'
          : 'completed',
      // Never log exception messages/stacks or client-provided strings.
      errorCode:
        this.errorCode ??
        (response.statusCode >= 400 ? `HTTP_${response.statusCode}` : null),
    };
    try {
      console.error(`[REQUEST_PROFILE] analyze ${JSON.stringify(summary)}`);
    } catch {
      // Diagnostic logging must not change the response lifecycle.
    }
  }
}

const profiles = new AsyncLocalStorage<AnalyzeRequestProfile>();
export const currentAnalyzeRequestProfile = () => profiles.getStore();

export function profileRequestPhase<T>(
  phase: Phase,
  work: () => Promise<T>,
): Promise<T> {
  const end = currentAnalyzeRequestProfile()?.begin(phase);
  if (!end) return work();
  return (async () => {
    try {
      return await work();
    } finally {
      end();
    }
  })();
}

export function profileRequestSync<T>(phase: Phase, work: () => T): T {
  const end = currentAnalyzeRequestProfile()?.begin(phase);
  try {
    return work();
  } finally {
    end?.();
  }
}

export function analyzeRequestProfileMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  if (
    process.env.HOI4_REQUEST_PROFILE !== '1' ||
    request.method !== 'POST' ||
    !/^\/api\/analyze\/?$/.test(request.originalUrl.split('?')[0])
  ) {
    next();
    return;
  }
  const profile = new AnalyzeRequestProfile();
  const json = response.json;
  response.json = function (body: unknown): Response {
    return profiles.run(profile, () =>
      profileRequestSync('responsePreparationMs', () => json.call(this, body)),
    );
  };
  const finish = () => {
    response.off('close', close);
    profile.finish(response, true);
  };
  const close = () => {
    response.off('finish', finish);
    profile.finish(response, response.writableFinished);
  };
  response.once('finish', finish);
  response.once('close', close);
  profiles.run(profile, next);
}

/** Register before app.init()/listen(), hence before Nest body parsers/guards. */
export function configureAnalyzeRequestProfiling(app: INestApplication): void {
  app.use(analyzeRequestProfileMiddleware);
}
