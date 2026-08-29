import { parentPort, workerData } from 'node:worker_threads';
import { analyzeSave, type AnalyzeResult } from '../hoi4-parser';
import { SaveInputError, type SaveErrorCode } from '../save-input.error';
import type { SaveUploadPolicy } from '../save-upload.policy';

interface WorkerSerializedError {
  name: string;
  message: string;
  stack?: string;
  code?: SaveErrorCode;
}

export type AnalysisWorkerMessage =
  | { ok: true; result: AnalyzeResult }
  | { ok: false; error: WorkerSerializedError };

if (!parentPort) throw new Error('Save analysis requires a worker parent port');

const { filePath, uploadPolicy } = workerData as {
  filePath: string;
  uploadPolicy: Readonly<SaveUploadPolicy>;
};
let message: AnalysisWorkerMessage;
try {
  const result = analyzeSave(filePath, { validateInput: true, uploadPolicy });
  if (result.game_date === 'unknown')
    throw new SaveInputError('UNSUPPORTED_SAVE');
  message = { ok: true, result };
} catch (error: unknown) {
  const failure = error instanceof Error ? error : new Error(String(error));
  message = {
    ok: false,
    error: {
      name: failure.name,
      message: failure.message,
      stack: failure.stack,
      ...(failure instanceof SaveInputError ? { code: failure.code } : {}),
    },
  };
}
parentPort.postMessage(message);
