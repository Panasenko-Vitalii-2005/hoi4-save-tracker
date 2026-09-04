import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { SESSION_TTL_SECONDS } from './auth.config';
import {
  AuthUnavailableError,
  AuthValidationError,
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidSessionError,
} from './auth.errors';
import { normalizeEmail, validatePassword } from './auth.config';
import { PasswordService } from './password.service';
import { SessionRepository } from './session.repository';
import { SessionTokenService } from './session-token.service';
import type { AuthSessionResult, SafeUserDto } from './auth.types';
import { safeUser } from './auth.types';
import { UserRepository } from './user.repository';

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    private readonly passwords: PasswordService,
    private readonly tokens: SessionTokenService,
    @Inject(SESSION_TTL_SECONDS) private readonly sessionTtlSeconds: number,
  ) {}

  private requireDatabase(): void {
    if (!this.database.available()) throw new AuthUnavailableError();
  }

  private async databaseOperation<T>(operation: () => Promise<T>): Promise<T> {
    this.requireDatabase();
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DuplicateEmailError) throw error;
      throw new AuthUnavailableError();
    }
  }

  private newSession() {
    const token = this.tokens.generate();
    const tokenHash = this.tokens.hash(token);
    const expiresAt = new Date(Date.now() + this.sessionTtlSeconds * 1000);
    return { token, tokenHash, expiresAt };
  }

  async register(
    email: unknown,
    password: unknown,
  ): Promise<AuthSessionResult> {
    this.requireDatabase();
    const normalizedEmail = normalizeEmail(email);
    const validPassword = validatePassword(password);
    const passwordHash = await this.passwords.hash(validPassword);
    const session = this.newSession();

    return this.databaseOperation(() =>
      this.database.transaction(async (executor) => {
        const user = await this.users.create(
          normalizedEmail,
          passwordHash,
          executor,
        );
        await this.sessions.create(
          user.id,
          session.tokenHash,
          session.expiresAt,
          executor,
        );
        return {
          user: safeUser(user),
          token: session.token,
          expiresAt: session.expiresAt,
        };
      }),
    );
  }

  async login(email: unknown, password: unknown): Promise<AuthSessionResult> {
    this.requireDatabase();
    let normalizedEmail: string;
    let validPassword: string;
    try {
      normalizedEmail = normalizeEmail(email);
      validPassword = validatePassword(password);
    } catch (error) {
      if (error instanceof AuthValidationError) {
        throw new InvalidCredentialsError();
      }
      throw error;
    }

    const user = await this.databaseOperation(() =>
      this.users.findByEmail(normalizedEmail),
    );
    if (!user?.passwordHash) {
      await this.passwords.verifyDummy(validPassword);
      throw new InvalidCredentialsError();
    }

    const verified = await this.passwords.verify(
      validPassword,
      user.passwordHash,
    );
    if (!verified || user.disabled) throw new InvalidCredentialsError();

    const session = this.newSession();
    await this.databaseOperation(() =>
      this.sessions.create(user.id, session.tokenHash, session.expiresAt),
    );
    return {
      user: safeUser(user),
      token: session.token,
      expiresAt: session.expiresAt,
    };
  }

  async authenticateSession(rawToken: unknown): Promise<SafeUserDto> {
    this.requireDatabase();
    if (!this.tokens.valid(rawToken)) throw new InvalidSessionError();
    const tokenHash = this.tokens.hash(rawToken);
    const session = await this.databaseOperation(() =>
      this.sessions.findByTokenHash(tokenHash),
    );
    if (!session) throw new InvalidSessionError();
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.databaseOperation(() => this.sessions.revoke(tokenHash));
      throw new InvalidSessionError();
    }
    const user = await this.databaseOperation(() =>
      this.users.findById(session.userId),
    );
    if (!user || user.disabled) throw new InvalidSessionError();
    return safeUser(user);
  }

  async logout(rawToken: unknown): Promise<void> {
    this.requireDatabase();
    if (!this.tokens.valid(rawToken)) return;
    await this.databaseOperation(() =>
      this.sessions.revoke(this.tokens.hash(rawToken)),
    );
  }
}
