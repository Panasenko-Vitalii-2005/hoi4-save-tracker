import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SESSION_COOKIE_SECURE } from './auth.config';
import {
  clearSessionCookie,
  readSessionCookie,
  setSessionCookie,
} from './auth.cookie';
import {
  AuthUnavailableError,
  AuthValidationError,
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidSessionError,
} from './auth.errors';
import { AuthService } from './auth.service';

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
}

function authHttpError(error: unknown): never {
  if (error instanceof AuthValidationError) {
    throw new BadRequestException(error.message);
  }
  if (error instanceof DuplicateEmailError) {
    throw new ConflictException('An account with this email already exists');
  }
  if (
    error instanceof InvalidCredentialsError ||
    error instanceof InvalidSessionError
  ) {
    throw new UnauthorizedException('Invalid authentication');
  }
  if (error instanceof AuthUnavailableError) {
    throw new ServiceUnavailableException(
      'Authentication storage is unavailable',
    );
  }
  throw new InternalServerErrorException('Authentication request failed');
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(SESSION_COOKIE_SECURE) private readonly secureCookie: boolean,
  ) {}

  @Post('register')
  async register(
    @Body() body: CredentialsBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.auth.register(body?.email, body?.password);
      setSessionCookie(
        response,
        result.token,
        result.expiresAt,
        this.secureCookie,
      );
      return { user: result.user };
    } catch (error) {
      authHttpError(error);
    }
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() body: CredentialsBody,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const result = await this.auth.login(body?.email, body?.password);
      setSessionCookie(
        response,
        result.token,
        result.expiresAt,
        this.secureCookie,
      );
      return { user: result.user };
    } catch (error) {
      authHttpError(error);
    }
  }

  @Get('me')
  async me(@Req() request: Request) {
    try {
      const user = await this.auth.authenticateSession(
        readSessionCookie(request.headers.cookie),
      );
      return { user };
    } catch (error) {
      authHttpError(error);
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await this.auth.logout(readSessionCookie(request.headers.cookie));
      clearSessionCookie(response, this.secureCookie);
    } catch (error) {
      authHttpError(error);
    }
  }
}
