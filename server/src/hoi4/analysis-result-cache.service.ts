import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { Hoi4AnalysisWorkerService } from './hoi4-analysis-worker.service';
import type { AnalyzeResult } from './hoi4-parser';

export async function hashSaveContents(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk as Buffer);
  }
  return hash.digest('hex');
}

@Injectable()
export class AnalysisResultCacheService {
  private readonly completed = new Map<string, AnalyzeResult>();
  private readonly inFlight = new Map<string, Promise<AnalyzeResult>>();
  private readonly limit: number;

  constructor(private readonly analysis: Hoi4AnalysisWorkerService) {
    const configured = Number(process.env.HOI4_ANALYSIS_CACHE_ENTRIES ?? 3);
    this.limit =
      Number.isSafeInteger(configured) && configured > 0 ? configured : 3;
  }

  async analyze(filePath: string): Promise<AnalyzeResult> {
    return (await this.analyzeWithHash(filePath)).result;
  }

  async analyzeWithHash(
    filePath: string,
  ): Promise<{ hash: string; result: AnalyzeResult }> {
    const hash = await hashSaveContents(filePath);
    return { hash, result: await this.analyzeHash(filePath, hash) };
  }

  private async analyzeHash(
    filePath: string,
    hash: string,
  ): Promise<AnalyzeResult> {
    const cached = this.completed.get(hash);
    if (cached) {
      this.completed.delete(hash);
      this.completed.set(hash, cached);
      return cached;
    }

    const pending = this.inFlight.get(hash);
    if (pending) return pending;

    const result = this.analysis
      .analyze(filePath)
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
