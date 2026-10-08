import {
  Injectable,
  HttpException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthenticatedRequest } from '../auth/current-user.decorator';
import {
  abuseRoute,
  AbuseProtectionService,
  rateLimitBody,
} from './abuse-protection.service';

@Injectable()
export class AbuseProtectionGuard implements CanActivate {
  constructor(private readonly limits: AbuseProtectionService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const route = abuseRoute(request);
    if (!route || !this.limits.enabled) return true;
    let identity = request.user?.id;
    if (route === 'register' || route === 'login') {
      const body: unknown = request.body;
      const email =
        body && typeof body === 'object' && 'email' in body ? body.email : null;
      // Same normalization as AuthService, bounded before hashing or validation.
      identity =
        typeof email === 'string' && email.length <= 254
          ? email.trim().toLowerCase()
          : 'invalid-account';
    }
    if (!identity) return true; // SessionGuard already rejected unauthenticated private requests.
    const retry = this.limits.identityLimit(route, identity);
    if (retry === null) return true;
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Retry-After', retry);
    response.setHeader('Cache-Control', 'no-store');
    throw new HttpException(rateLimitBody(retry), 429);
  }
}
