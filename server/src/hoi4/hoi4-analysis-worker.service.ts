import {
  Injectable,
  type OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { AnalyzeResult } from './hoi4-parser';
import type { AnalysisWorkerMessage } from './workers/hoi4-analysis.worker';
import {
  SaveInputError,
  isSaveErrorCode,
  SAVE_ERRORS,
} from './save-input.error';
import { saveUploadPolicy } from './save-upload.policy';
import {
  normalizeSaveComparisonContext,
  unknownSaveComparisonContext,
  type SaveComparisonContext,
} from './save-comparison-context';

export interface AnalyzedSave {
  result: AnalyzeResult;
  comparisonContext: SaveComparisonContext;
}

@Injectable()
export class Hoi4AnalysisWorkerService implements OnModuleDestroy {
  private readonly workers = new Set<Worker>();
  private readonly limit: number;
  private closing = false;
  private readonly policy = saveUploadPolicy();

  constructor() {
    this.limit = Number(process.env.HOI4_ANALYSIS_WORKERS ?? 1);
    if (!Number.isSafeInteger(this.limit) || this.limit < 1) {
      throw new Error('HOI4_ANALYSIS_WORKERS must be a positive integer');
    }
  }

  async analyze(filePath: string): Promise<AnalyzeResult> {
    return (await this.analyzeWithContext(filePath)).result;
  }

  async analyzeWithContext(filePath: string): Promise<AnalyzedSave> {
    if (this.closing || this.workers.size >= this.limit) {
      throw new ServiceUnavailableException({
        code: 'ANALYZER_BUSY',
        message: SAVE_ERRORS.ANALYZER_BUSY[1],
      });
    }

    const worker = this.createWorker(filePath);
    this.workers.add(worker);

    return new Promise<AnalyzedSave>((resolve, reject) => {
      let settled = false;
      const finish = async (
        outcome: { analysis: AnalyzedSave } | { error: Error },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          // Do not release the slot or allow upload cleanup until the thread exits.
          await worker.terminate();
        } catch (error: unknown) {
          outcome = {
            error: error instanceof Error ? error : new Error(String(error)),
          };
        } finally {
          worker.off('message', onMessage);
          worker.off('error', onError);
          worker.off('exit', onExit);
          this.workers.delete(worker);
        }
        if ('error' in outcome) reject(outcome.error);
        else resolve(outcome.analysis);
      };
      const onMessage = (message: AnalysisWorkerMessage) => {
        if (message.ok) {
          void finish({
            analysis: {
              result: message.result,
              comparisonContext:
                normalizeSaveComparisonContext(message.comparisonContext) ??
                unknownSaveComparisonContext(),
            },
          });
        } else {
          const error = isSaveErrorCode(message.error.code)
            ? new SaveInputError(message.error.code)
            : new Error(message.error.message);
          error.name = message.error.name;
          if (message.error.stack) error.stack = message.error.stack;
          void finish({ error });
        }
      };
      const onError = (error: Error) => void finish({ error });
      const onExit = (code: number) =>
        void finish({
          error: new Error(
            `Save analysis worker exited without a result (code ${code})`,
          ),
        });
      const timer = setTimeout(
        () => void finish({ error: new SaveInputError('ANALYSIS_TIMEOUT') }),
        this.policy.analysisTimeoutMs,
      );
      timer.unref();
      worker.on('message', onMessage);
      worker.on('error', onError);
      worker.on('exit', onExit);
    });
  }

  protected createWorker(filePath: string): Worker {
    // Nest start/watch and production run emitted JS. Source/Jest uses ts-node
    // explicitly, never a stale dist worker or a production dev dependency.
    const source = __filename.endsWith('.ts');
    return new Worker(
      join(
        __dirname,
        'workers',
        `hoi4-analysis.worker.${source ? 'ts' : 'js'}`,
      ),
      {
        workerData: { filePath, uploadPolicy: this.policy },
        resourceLimits: { maxOldGenerationSizeMb: this.policy.maxWorkerHeapMb },
        execArgv: source
          ? ['--require', require.resolve('ts-node/register/transpile-only')]
          : [],
      },
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    await Promise.all([...this.workers].map((worker) => worker.terminate()));
  }
}
