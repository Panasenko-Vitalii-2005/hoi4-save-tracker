import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import {
  sessionCookieSecure,
  SESSION_COOKIE_SECURE,
  sessionTtlSeconds,
  SESSION_TTL_SECONDS,
} from './auth.config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { SessionRepository } from './session.repository';
import { SessionTokenService } from './session-token.service';
import { UserRepository } from './user.repository';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [
    { provide: SESSION_TTL_SECONDS, useFactory: sessionTtlSeconds },
    { provide: SESSION_COOKIE_SECURE, useFactory: sessionCookieSecure },
    UserRepository,
    SessionRepository,
    PasswordService,
    SessionTokenService,
    AuthService,
  ],
})
export class AuthModule {}
