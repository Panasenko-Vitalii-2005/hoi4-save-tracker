import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  Hoi4AnalysisWorkerService,
  type AnalyzedSave,
} from './hoi4-analysis-worker.service';
import type { AnalyzeResult } from './hoi4-parser';
import type { SaveComparisonContext } from './save-comparison-context';

export async function hashSaveContents(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

@Injectable()
export class AnalysisResultCacheService {
  private readonly completed = new Map<string, AnalyzedSave>();
  private readonly inFlight = new Map<string, Promise<AnalyzedSave>>();
  private readonly limit: number;

  constructor(private readonly analysis: Hoi4AnalysisWorkerService) {
    const configured = Number(process.env.HOI4_ANALYSIS_CACHE_ENTRIES ?? 3);
    this.limit =
      Number.isSafeInteger(configured) && configured > 0 ? configured : 3;
  }

  async analyze(filePath: string): Promise<AnalyzeResult> {
    return (await this.analyzeWithHash(filePath)).result;
  }

  /** Forget a completed result only; an explicit new/in-flight analysis may add it again. */
  delete(hash: string): void {
    this.completed.delete(hash);
  }

  async analyzeWithHash(filePath: string): Promise<{
    hash: string;
    result: AnalyzeResult;
    comparisonContext: SaveComparisonContext;
  }> {
    const hash = await hashSaveContents(filePath);
    return { hash, ...(await this.analyzeHash(filePath, hash)) };
  }

  private async analyzeHash(
    filePath: string,
    hash: string,
  ): Promise<AnalyzedSave> {
    const cached = this.completed.get(hash);
    if (cached) {
      this.completed.delete(hash);
      this.completed.set(hash, cached);
      return cached;
    }

    const pending = this.inFlight.get(hash);
    if (pending) return pending;

    const result = this.analysis
      .analyzeWithContext(filePath)
      .then((value) => {
        // Consumers serialize these results without mutation. Keep the original
        // parse_seconds; it is not the duration of the current HTTP request.
        this.completed.set(hash, value);
        if (this.completed.size > this.limit) {
          for (const oldest of this.completed.keys()) {
            this.completed.delete(oldest);
            break;
          }
        }
        return value;
      })
      .finally(() => this.inFlight.delete(hash));
    this.inFlight.set(hash, result);
    return result;
  }
}
