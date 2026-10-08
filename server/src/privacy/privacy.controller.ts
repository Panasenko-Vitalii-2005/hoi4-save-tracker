import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../auth/route-access.decorator';

/** Plain mailbox only; forbid headers, display names, control characters and URL
 * query injection. Invalid/missing configuration exposes no guessed address. */
export function publicSupportEmail(
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  const email = environment.HOI4_SUPPORT_EMAIL?.trim();
  if (
    !email ||
    email.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+\-/=^_`{|}~]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(
      email,
    )
  )
    return null;
  const local = email.split('@')[0];
  if (
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  )
    return null;
  if (
    email
      .split('@')[1]
      .split('.')
      .some((label) => label.length > 63)
  )
    return null;
  return email;
}

@Controller('api/privacy')
export class PrivacyController {
  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  contact() {
    return { supportEmail: publicSupportEmail() };
  }
}
