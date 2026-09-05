import { Injectable } from '@nestjs/common';
import { normalizeAnalysisHash } from './persisted-analysis-result.service';
import { AnalysisOwnershipRepository } from './analysis-ownership.repository';

@Injectable()
export class AnalysisOwnershipService {
  constructor(private readonly ownership: AnalysisOwnershipRepository) {}

  async ensureOwnership(userId: string, analysisHash: string): Promise<void> {
    await this.ownership.ensureOwnership(userId, this.hash(analysisHash));
  }

  async hasOwnership(userId: string, analysisHash: string): Promise<boolean> {
    return this.ownership.hasOwnership(userId, this.hash(analysisHash));
  }

  private hash(value: string): string {
    const hash = normalizeAnalysisHash(value);
    if (!hash) throw new TypeError('Invalid analysis hash');
    return hash;
  }
}
