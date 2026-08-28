import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSave, type AnalyzeResult } from '../hoi4-parser';

interface WorkerSerializedError {
  name: string;
  message: string;
  stack?: string;
}

export type AnalysisWorkerMessage =
  | { ok: true; result: AnalyzeResult }
  | { ok: false; error: WorkerSerializedError };

if (!parentPort) throw new Error('Save analysis requires a worker parent port');

const { filePath } = workerData as { filePath: string };
let message: AnalysisWorkerMessage;
try {
  message = { ok: true, result: analyzeSave(filePath) };
} catch (error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error));
  message = {
    ok: false,
    error: {
      name: failure.name,
      message: failure.message,
      stack: failure.stack,
    },
  };
}
parentPort.postMessage(message);
