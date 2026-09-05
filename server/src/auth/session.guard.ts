import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { requireLocalSavesEnabled } from '../saves/local-saves-access';
import { readSessionCookie } from './auth.cookie';
import { authHttpError } from './auth.http-error';
import { AuthService } from './auth.service';
import type { AuthenticatedRequest } from './current-user.decorator';
import { CsrfService } from './csrf.service';
import { IS_PUBLIC_ROUTE, LOCAL_SAVE_ACCESS } from './route-access.decorator';

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly csrf: CsrfService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const localAccess = this.reflector.getAllAndOverride<'route' | 'input'>(
      LOCAL_SAVE_ACCESS,
      targets,
    );
    const body: unknown = request.body;
    if (
      localAccess === 'route' ||
      (localAccess === 'input' &&
        !request.is('multipart/form-data') &&
        body !== null &&
        typeof body === 'object' &&
        'path' in body)
    ) {
      requireLocalSavesEnabled();
    }

    // CORS preflight is handled before Nest; do not authenticate explicit OPTIONS.
    if (request.method === 'OPTIONS') return true;

    if (!this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, targets)) {
      const token = readSessionCookie(request.headers.cookie);
      if (!token) throw new UnauthorizedException('Invalid authentication');
      try {
        request.user = await this.auth.authenticateSession(token);
      } catch (error) {
        authHttpError(error);
      }
    }

    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      this.csrf.validate(request);
    }
    return true;
  }
}
