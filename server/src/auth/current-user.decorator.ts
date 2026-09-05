import {
  createParamDecorator,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import type { SafeUserDto } from './auth.types';

export interface AuthenticatedRequest extends Request {
  user?: SafeUserDto;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SafeUserDto => {
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
    if (!user) throw new UnauthorizedException('Invalid authentication');
    return user;
  },
);
