import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import { DatabaseService } from '../database/database.service';

interface OwnershipExistsRow extends QueryResultRow {
  owned: boolean;
}

@Injectable()
export class AnalysisOwnershipRepository {
  constructor(private readonly database: DatabaseService) {}

  async ensureOwnership(userId: string, analysisHash: string): Promise<void> {
    await this.database.query(
      `INSERT INTO analysis_ownership (user_id, analysis_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id, analysis_hash) DO NOTHING`,
      [userId, analysisHash],
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
}
