import { NotFoundException } from '@nestjs/common';

export function localSavesEnabled(
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  const value = environment.HOI4_LOCAL_SAVES_ENABLED;
  return value?.trim().toLowerCase() === 'true';
}

export function requireLocalSavesEnabled(): void {
  if (!localSavesEnabled()) throw new NotFoundException();
}
