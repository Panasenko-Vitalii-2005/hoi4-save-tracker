import { Injectable } from '@nestjs/common';
import { basename, win32 } from 'node:path';
import { normalizeAnalysisHash } from './analysis-hash';
import {
  AnalysisOwnershipRepository,
  type AnalysisOwnershipRow,
} from './analysis-ownership.repository';

export interface AnalysisOwnershipMetadata {
  fileName: string;
  analyzedAt?: Date;
}

export interface AnalysisOwnership {
  analysisHash: string;
  pinned: boolean;
  fileName: string | null;
  analyzedAt: string;
}

function safeFileName(name: string): string {
  return win32.basename(basename(name)) || 'Unnamed save';
}

@Injectable()
export class AnalysisOwnershipService {
  constructor(private readonly ownership: AnalysisOwnershipRepository) {}

  async ensureOwnership(
    userId: string,
    analysisHash: string,
    metadata?: AnalysisOwnershipMetadata,
  ): Promise<void> {
    await this.ownership.ensureOwnership(
      userId,
      this.hash(analysisHash),
      metadata
        ? {
            fileName: safeFileName(metadata.fileName),
            analyzedAt: metadata.analyzedAt ?? new Date(),
          }
        : undefined,
    );
  }

  async hasOwnership(userId: string, analysisHash: string): Promise<boolean> {
    return this.ownership.hasOwnership(userId, this.hash(analysisHash));
  }

  async listForUser(userId: string): Promise<AnalysisOwnership[]> {
    return (await this.ownership.listForUser(userId)).map((row) =>
      this.toOwnership(row),
    );
  }

  async listAllOwnedHashes(): Promise<Set<string>> {
    return new Set(
      (await this.ownership.listAllOwnedHashes()).map((hash) =>
        this.hash(hash),
      ),
    );
  }

  async ownedHashes(
    userId: string,
    analysisHashes: readonly string[],
  ): Promise<Set<string>> {
    const hashes = [...new Set(analysisHashes.map((hash) => this.hash(hash)))];
    return new Set(await this.ownership.ownedHashes(userId, hashes));
  }

  async hasAllOwnership(
    userId: string,
    analysisHashes: readonly string[],
  ): Promise<boolean> {
    const hashes = [...new Set(analysisHashes.map((hash) => this.hash(hash)))];
    return (
      (await this.ownership.ownedHashes(userId, hashes)).length ===
      hashes.length
    );
  }

  setPinned(
    userId: string,
    analysisHash: string,
    pinned: boolean,
  ): Promise<boolean> {
    return this.ownership.setPinned(userId, this.hash(analysisHash), pinned);
  }

  remove(userId: string, analysisHashes: readonly string[]): Promise<string[]> {
    const hashes = [...new Set(analysisHashes.map((hash) => this.hash(hash)))];
    return this.ownership.remove(userId, hashes);
  }

  async pinnedHashes(analysisHashes: readonly string[]): Promise<Set<string>> {
    const hashes = [...new Set(analysisHashes.map((hash) => this.hash(hash)))];
    return new Set(await this.ownership.pinnedHashes(hashes));
  }

  private hash(value: string): string {
    const hash = normalizeAnalysisHash(value);
    if (!hash) throw new TypeError('Invalid analysis hash');
    return hash;
  }

  private toOwnership(row: AnalysisOwnershipRow): AnalysisOwnership {
    return {
      analysisHash: row.analysisHash,
      pinned: row.pinned,
      fileName: row.fileName,
      analyzedAt: new Date(row.analyzedAt).toISOString(),
    };
  }
}
