import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface OwnershipExistsRow extends QueryResultRow {
  owned: boolean;
}

export interface AnalysisOwnershipRow extends QueryResultRow {
  analysisHash: string;
  pinned: boolean;
  fileName: string | null;
  analyzedAt: Date;
}

interface AnalysisHashRow extends QueryResultRow {
  analysisHash: string;
}

@Injectable()
export class AnalysisOwnershipRepository {
  constructor(private readonly database: DatabaseService) {}

  async ensureOwnership(
    userId: string,
    analysisHash: string,
    metadata?: { fileName: string; analyzedAt: Date },
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO analysis_ownership
         (user_id, analysis_hash, file_name, analyzed_at)
       VALUES ($1, $2, $3, COALESCE($4, now()))
       ON CONFLICT (user_id, analysis_hash) DO UPDATE SET
         file_name = COALESCE(EXCLUDED.file_name, analysis_ownership.file_name),
         analyzed_at = CASE
           WHEN EXCLUDED.file_name IS NULL THEN analysis_ownership.analyzed_at
           ELSE EXCLUDED.analyzed_at
         END`,
      [
        userId,
        analysisHash,
        metadata?.fileName ?? null,
        metadata?.analyzedAt ?? null,
      ],
    );
  }

  async hasOwnership(userId: string, analysisHash: string): Promise<boolean> {
    const result = await this.database.query<OwnershipExistsRow>(
      `SELECT EXISTS (
         SELECT 1
         FROM analysis_ownership
         WHERE user_id = $1 AND analysis_hash = $2
       ) AS owned`,
      [userId, analysisHash],
    );
    return result.rows[0]?.owned === true;
  }

  async listForUser(userId: string): Promise<AnalysisOwnershipRow[]> {
    const result = await this.database.query<AnalysisOwnershipRow>(
      `SELECT analysis_hash AS "analysisHash",
              pinned,
              file_name AS "fileName",
              analyzed_at AS "analyzedAt"
       FROM analysis_ownership
       WHERE user_id = $1
       ORDER BY analyzed_at DESC, analysis_hash ASC`,
      [userId],
    );
    return result.rows;
  }

  async ownedHashes(
    userId: string,
    analysisHashes: readonly string[],
  ): Promise<string[]> {
    if (analysisHashes.length === 0) return [];
    const result = await this.database.query<AnalysisHashRow>(
      `SELECT analysis_hash AS "analysisHash"
       FROM analysis_ownership
       WHERE user_id = $1 AND analysis_hash = ANY($2::text[])`,
      [userId, analysisHashes],
    );
    return result.rows.map((row) => row.analysisHash);
  }

  async setPinned(
    userId: string,
    analysisHash: string,
    pinned: boolean,
  ): Promise<boolean> {
    const result = await this.database.query<AnalysisHashRow>(
      `UPDATE analysis_ownership
       SET pinned = $3
       WHERE user_id = $1 AND analysis_hash = $2
       RETURNING analysis_hash AS "analysisHash"`,
      [userId, analysisHash, pinned],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async remove(
    userId: string,
    analysisHashes: readonly string[],
  ): Promise<string[]> {
    if (analysisHashes.length === 0) return [];
    const result = await this.database.query<AnalysisHashRow>(
      `DELETE FROM analysis_ownership
       WHERE user_id = $1 AND analysis_hash = ANY($2::text[])
       RETURNING analysis_hash AS "analysisHash"`,
      [userId, analysisHashes],
    );
    return result.rows.map((row) => row.analysisHash);
  }

  async pinnedHashes(analysisHashes: readonly string[]): Promise<string[]> {
    if (analysisHashes.length === 0) return [];
    const result = await this.database.query<AnalysisHashRow>(
      `SELECT DISTINCT analysis_hash AS "analysisHash"
       FROM analysis_ownership
       WHERE pinned = true AND analysis_hash = ANY($1::text[])`,
      [analysisHashes],
    );
    return result.rows.map((row) => row.analysisHash);
  }
}
