export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  isAdmin: boolean;
  disabled: boolean;
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  lastSeenAt: Date | null;
}

export interface SafeUserDto {
  id: string;
  email: string;
  createdAt: string;
}

export interface AuthSessionResult {
  user: SafeUserDto;
  token: string;
  expiresAt: Date;
}

export function safeUser(user: UserRecord): SafeUserDto {
  return {
    id: user.id,
    email: user.email,
    createdAt: user.createdAt.toISOString(),
  };
}
