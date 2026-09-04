import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import {
  DatabaseService,
  type DatabaseExecutor,
} from '../database/database.service';
import type { SessionRecord } from './auth.types';

interface SessionRow extends QueryResultRow {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date | null;
}

const SESSION_FIELDS = `
  id,
  user_id AS "userId",
  token_hash AS "tokenHash",
  expires_at AS "expiresAt",
  created_at AS "createdAt",
  last_seen_at AS "lastSeenAt"
`;

@Injectable()
export class SessionRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
    executor: DatabaseExecutor = this.database,
  ): Promise<SessionRecord> {
    const result = await executor.query<SessionRow>(
      `INSERT INTO sessions (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)
       RETURNING ${SESSION_FIELDS}`,
      [userId, tokenHash, expiresAt],
    );
    return result.rows[0];
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.database.query<SessionRow>(
      `SELECT ${SESSION_FIELDS}
       FROM sessions
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash],
    );
    return result.rows[0] ?? null;
  }

  async revoke(tokenHash: string): Promise<void> {
    await this.database.query('DELETE FROM sessions WHERE token_hash = $1', [
      tokenHash,
    ]);
  }
}
