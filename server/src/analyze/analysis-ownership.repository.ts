import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { OwnedHistoryMetadata } from './owned-analysis-history';

interface OwnershipExistsRow extends QueryResultRow {
  owned: boolean;
}

export interface AnalysisOwnershipRow extends QueryResultRow {
  analysisHash: string;
  pinned: boolean;
  fileName: string | null;
  analyzedAt: Date;
  historyMetadata?: unknown;
  canonicalFileSizeBytes?: string | null;
  cursorAnalyzedAt?: string;
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
    metadata?: {
      fileName: string;
      analyzedAt: Date;
      historyMetadata?: OwnedHistoryMetadata;
    },
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO analysis_ownership
         (user_id, analysis_hash, file_name, analyzed_at, history_metadata)
       VALUES ($1, $2, $3, COALESCE($4, now()), $5::jsonb)
       ON CONFLICT (user_id, analysis_hash) DO UPDATE SET
         file_name = COALESCE(EXCLUDED.file_name, analysis_ownership.file_name),
         analyzed_at = CASE
           WHEN EXCLUDED.file_name IS NULL THEN analysis_ownership.analyzed_at
           ELSE EXCLUDED.analyzed_at
         END,
         history_metadata = COALESCE(EXCLUDED.history_metadata, analysis_ownership.history_metadata)`,
      [
        userId,
        analysisHash,
        metadata?.fileName ?? null,
        metadata?.analyzedAt ?? null,
        metadata?.historyMetadata
          ? JSON.stringify(metadata.historyMetadata)
          : null,
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
    const rows: AnalysisOwnershipRow[] = [];
    // Indexed keyset pages, never OFFSET or a global Recent cutoff. Keep the existing
    // complete-list API and client filtering while bounding each database query.
    let cursor: AnalysisOwnershipRow | undefined;
    do {
      const result = await this.database.query<AnalysisOwnershipRow>(
        `SELECT owned.analysis_hash AS "analysisHash", owned.pinned,
                owned.file_name AS "fileName", owned.analyzed_at AS "analyzedAt",
                owned.history_metadata AS "historyMetadata",
                owned.analyzed_at::text AS "cursorAnalyzedAt",
                analyses.file_size_bytes::text AS "canonicalFileSizeBytes"
         FROM analysis_ownership owned
         LEFT JOIN analyses ON analyses.content_hash = owned.analysis_hash
         WHERE owned.user_id = $1 AND ($2::timestamptz IS NULL OR
           (owned.analyzed_at <= $2 AND
            (owned.analyzed_at < $2 OR owned.analysis_hash > $3)))
         ORDER BY owned.analyzed_at DESC, owned.analysis_hash ASC LIMIT 100`,
        [
          userId,
          cursor?.cursorAnalyzedAt ?? cursor?.analyzedAt ?? null,
          cursor?.analysisHash ?? null,
        ],
      );
      rows.push(...result.rows);
      cursor = result.rows.length === 100 ? result.rows.at(-1) : undefined;
    } while (cursor);
    return rows;
  }

  async setHistoryMetadata(
    userId: string,
    hash: string,
    metadata: OwnedHistoryMetadata,
  ): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE analysis_ownership SET history_metadata = $3::jsonb
       WHERE user_id = $1 AND analysis_hash = $2 RETURNING analysis_hash`,
      [userId, hash, JSON.stringify(metadata)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async listAllOwnedHashes(): Promise<string[]> {
    const result = await this.database.query<AnalysisHashRow>(
      `SELECT DISTINCT analysis_hash AS "analysisHash"
       FROM analysis_ownership
       ORDER BY analysis_hash ASC`,
    );
    return result.rows.map((row) => row.analysisHash);
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
