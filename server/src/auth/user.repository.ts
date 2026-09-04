import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import {
  DatabaseService,
  type DatabaseExecutor,
} from '../database/database.service';
import { DuplicateEmailError } from './auth.errors';
import type { UserRecord } from './auth.types';

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  passwordHash: string | null;
  isAdmin: boolean;
  disabled: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const USER_FIELDS = `
  id,
  email::text AS email,
  password_hash AS "passwordHash",
  is_admin AS "isAdmin",
  disabled,
  email_verified_at AS "emailVerifiedAt",
  created_at AS "createdAt",
  updated_at AS "updatedAt"
`;

function postgresCode(error: unknown): string | null {
  return error && typeof error === 'object' && 'code' in error
    ? String(error.code)
    : null;
}

@Injectable()
export class UserRepository {
  constructor(private readonly database: DatabaseService) {}

  async create(
    email: string,
    passwordHash: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<UserRecord> {
    try {
      const result = await executor.query<UserRow>(
        `INSERT INTO users (email, password_hash)
         VALUES ($1, $2)
         RETURNING ${USER_FIELDS}`,
        [email, passwordHash],
      );
      return result.rows[0];
    } catch (error) {
      if (postgresCode(error) === '23505') throw new DuplicateEmailError();
      throw error;
    }
  }

  async findByEmail(
    email: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<UserRecord | null> {
    const result = await executor.query<UserRow>(
      `SELECT ${USER_FIELDS} FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    return result.rows[0] ?? null;
  }

  async findById(
    id: string,
    executor: DatabaseExecutor = this.database,
  ): Promise<UserRecord | null> {
    const result = await executor.query<UserRow>(
      `SELECT ${USER_FIELDS} FROM users WHERE id = $1 LIMIT 1`,
      [id],
    );
    return result.rows[0] ?? null;
  }
}
