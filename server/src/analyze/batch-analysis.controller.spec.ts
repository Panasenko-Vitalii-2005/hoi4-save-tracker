import { HttpException } from '@nestjs/common';
import { BatchAnalysisController } from './batch-analysis.controller';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';

describe('BatchAnalysisController', () => {
  const known = 'a'.repeat(64);
  const fresh = 'b'.repeat(64);
  const available = jest.fn((hashes: readonly string[]) =>
    Promise.resolve(new Set(hashes.filter((hash) => hash === known))),
  );
  const controller = new BatchAnalysisController({
    available,
  } as unknown as PersistedAnalysisResultService);

  beforeEach(() => available.mockClear());

  it('returns only already-persisted hashes without invoking analysis', async () => {
    await expect(
      controller.preflight({ hashes: [known.toUpperCase(), fresh, known] }),
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
    await expect(controller.preflight({ hashes })).rejects.toBeInstanceOf(
      HttpException,
    );
    expect(available).not.toHaveBeenCalled();
  });

  it('supports an empty batch', async () => {
    await expect(controller.preflight({ hashes: [] })).resolves.toEqual({
      knownHashes: [],
    });
    expect(available).toHaveBeenCalledWith([]);
  });
});
