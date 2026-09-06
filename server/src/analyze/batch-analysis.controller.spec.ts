import { HttpException } from '@nestjs/common';
import { BatchAnalysisController } from './batch-analysis.controller';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import type { SafeUserDto } from '../auth/auth.types';

describe('BatchAnalysisController', () => {
  const known = 'a'.repeat(64);
  const fresh = 'b'.repeat(64);
  const available = jest.fn((hashes: readonly string[]) =>
    Promise.resolve(new Set(hashes.filter((hash) => hash === known))),
  );
  const ownedHashes = jest.fn((_: string, hashes: readonly string[]) =>
    Promise.resolve(new Set(hashes)),
  );
  const user: SafeUserDto = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'owner@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const controller = new BatchAnalysisController(
    { available } as unknown as PersistedAnalysisResultService,
    { ownedHashes } as unknown as AnalysisOwnershipService,
  );

  beforeEach(() => {
    available.mockClear();
    ownedHashes.mockClear();
  });

  it('returns only already-persisted hashes without invoking analysis', async () => {
    await expect(
      controller.preflight(user, {
        hashes: [known.toUpperCase(), fresh, known],
      }),
    ).resolves.toEqual({ knownHashes: [known] });
    expect(available).toHaveBeenCalledWith([known, fresh]);
  });

  it.each([
    undefined,
    'not-an-array',
    [null],
    ['short'],
    ['g'.repeat(64)],
    Array.from({ length: 201 }, () => fresh),
  ])('rejects an invalid or oversized preflight body', async (hashes) => {
    await expect(controller.preflight(user, { hashes })).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(available).not.toHaveBeenCalled();
  });

  it('supports an empty batch', async () => {
    await expect(controller.preflight(user, { hashes: [] })).resolves.toEqual({
      knownHashes: [],
    });
    expect(available).toHaveBeenCalledWith([]);
  });

  it('does not reveal a globally available hash that the user does not own', async () => {
    ownedHashes.mockResolvedValueOnce(new Set([fresh]));

    await expect(
      controller.preflight(user, { hashes: [known, fresh] }),
    ).resolves.toEqual({ knownHashes: [] });
    expect(available).toHaveBeenCalledWith([fresh]);
  });

  it('fails closed when ownership storage is unavailable', async () => {
    ownedHashes.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(
      controller.preflight(user, { hashes: [known] }),
    ).rejects.toMatchObject({ status: 503 });
    expect(available).not.toHaveBeenCalled();
  });
});
