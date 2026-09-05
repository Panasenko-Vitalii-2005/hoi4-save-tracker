import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SESSION_COOKIE_SECURE } from './auth.config';
import { revokeSessionCookie, setSessionCookie } from './auth.cookie';
import { authHttpError } from './auth.http-error';
import { AuthService } from './auth.service';
import { CsrfService } from './csrf.service';
import { CurrentUser } from './current-user.decorator';
import { Public } from './route-access.decorator';
import type { SafeUserDto } from './auth.types';

interface CredentialsBody {
  email?: unknown;
  password?: unknown;
}

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
    @Inject(SESSION_COOKIE_SECURE) private readonly secureCookie: boolean,
  ) {}

  @Public()
  @Get('csrf')
  csrfToken(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    return { csrfToken: this.csrf.bootstrap(request, response) };
  }

  @Public()
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

  @Public()
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
  @Header('Cache-Control', 'no-store')
  me(@CurrentUser() user: SafeUserDto) {
    return { user };
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await revokeSessionCookie(
        this.auth,
        request,
        response,
        this.secureCookie,
      );
    } catch (error) {
      authHttpError(error);
    }
  }
}
