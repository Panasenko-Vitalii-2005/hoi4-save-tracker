import {
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AuthUnavailableError,
  AuthValidationError,
  DuplicateEmailError,
  InvalidCredentialsError,
  InvalidSessionError,
} from './auth.errors';

export function authHttpError(error: unknown): never {
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
