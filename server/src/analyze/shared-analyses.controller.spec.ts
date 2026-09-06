import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHash } from 'node:crypto';
import files from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import { analyzeSave, type AnalyzeResult } from '../hoi4/hoi4-parser';
import { PersistedAnalysisResultService } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import { SharedAnalysesController } from './shared-analyses.controller';
import { SharedAnalysesService } from './shared-analyses.service';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import type { NextFunction, Request, Response } from 'express';
import type { SafeUserDto } from '../auth/auth.types';

const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');

interface ShareResponse {
  id: string;
  path: string;
}

interface ErrorResponse {
  message: string;
}

describe('SharedAnalysesController', () => {
  const user: SafeUserDto = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'owner@example.com',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const originalShareFile = process.env.HOI4_SHARED_ANALYSES_FILE;
  const originalRecentFile = process.env.HOI4_RECENT_ANALYSES_FILE;
  const originalResultDirectory = process.env.HOI4_ANALYSIS_RESULTS_DIR;
  let directory: string;
  let app: INestApplication<App>;
  let result: AnalyzeResult;
  let results: PersistedAnalysisResultService;
  let shares: SharedAnalysesService;
  let history: RecentAnalysesService;
  const hasOwnership = jest.fn().mockResolvedValue(true);

  beforeEach(async () => {
    directory = await files.mkdtemp(join(tmpdir(), 'hoi4-share-api-'));
    process.env.HOI4_SHARED_ANALYSES_FILE = join(directory, 'shares.json');
    process.env.HOI4_RECENT_ANALYSES_FILE = join(directory, 'recent.json');
    process.env.HOI4_ANALYSIS_RESULTS_DIR = join(directory, 'results');
    const save = join(directory, 'fixture.hoi4');
    await files.writeFile(save, 'HOI4txt\ndate="1944.5.1.2"\ncountries={}');
    result = analyzeSave(save);
    const moduleRef = await Test.createTestingModule({
      controllers: [SharedAnalysesController],
      providers: [
        PersistedAnalysisResultService,
        SharedAnalysesService,
        RecentAnalysesService,
        {
          provide: AnalysisOwnershipService,
          useValue: { hasOwnership },
        },
      ],
    }).compile();
    results = moduleRef.get(PersistedAnalysisResultService);
    shares = moduleRef.get(SharedAnalysesService);
    history = moduleRef.get(RecentAnalysesService);
    app = moduleRef.createNestApplication();
    app.use(
      (
        request: Request & { user?: SafeUserDto },
        _response: Response,
        next: NextFunction,
      ) => {
        request.user = user;
        next();
      },
    );
    await app.init();
    hasOwnership.mockReset().mockResolvedValue(true);
    await history.list();
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
    await files.rm(directory, { recursive: true, force: true });
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('HOI4_SHARED_ANALYSES_FILE', originalShareFile);
    restore('HOI4_RECENT_ANALYSES_FILE', originalRecentFile);
    restore('HOI4_ANALYSIS_RESULTS_DIR', originalResultDirectory);
  });

  async function persist(name = 'a') {
    const key = hash(name);
    await history.record(
      { hash: key, fileName: 'private-original.hoi4', fileSizeBytes: 123 },
      result,
    );
    return key;
  }

  test('explicit creation returns only a public link and public GET returns the exact result', async () => {
    const key = await persist();
    const before = await history.list();
    const created = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(201);
    expect(created.body).toEqual({
      id: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/) as unknown,
      path: expect.stringMatching(/^\/share\/[A-Za-z0-9_-]{22}$/) as unknown,
    });
    expect(JSON.stringify(created.body)).not.toMatch(
      new RegExp(`${key}|private-original`, 'i'),
    );
    const createdBody = created.body as ShareResponse;
    const opened = await request(app.getHttpServer())
      .get(`/api/share/${createdBody.id}`)
      .expect(200);
    expect(opened.body).toEqual(result);
    expect(await history.list()).toEqual(before);
  });

  test('repeated creation for one hash is idempotent', async () => {
    const key = await persist();
    const first = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key.toUpperCase()}/share`)
      .expect(201);
    expect(second.body).toEqual(first.body);
  });

  test('result must be durably persisted before it can be shared', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${hash('missing')}/share`)
      .expect(404);
    expect((response.body as ErrorResponse).message).toBe(
      'Saved analysis result is unavailable',
    );
  });

  test('foreign and legacy hashes cannot create or revoke shares', async () => {
    const key = await persist('foreign');
    const existing = await shares.create(key);
    hasOwnership.mockResolvedValue(false);

    const create = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(404);
    const revoke = await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${key}/share`)
      .expect(404);
    expect((create.body as ErrorResponse).message).toBe(
      'Saved analysis result is unavailable',
    );
    expect((revoke.body as ErrorResponse).message).toBe(
      'Saved analysis result is unavailable',
    );
    expect(await shares.getResult(existing!.id)).toEqual(result);
  });

  test.each([
    'invalid',
    'a'.repeat(63),
    'g'.repeat(64),
    '..%2F..%2Fprivate',
    '..%5C..%5Cprivate',
  ])('share management rejects unsafe hash %s', async (key) => {
    const create = jest.spyOn(shares, 'create');
    const revoke = jest.spyOn(history, 'revokeShare');
    await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(400);
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${key}/share`)
      .expect(400);
    expect(create).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });

  test.each([
    'invalid',
    'A'.repeat(21),
    'A'.repeat(23),
    '..%2F..%2Fprivate',
    '..%5C..%5Cprivate',
    'AAAAAAAAAAAAAAAAAAAAA=',
  ])('public GET treats malformed identifier %s as unavailable', async (id) => {
    const get = jest.spyOn(shares, 'getResult');
    const response = await request(app.getHttpServer())
      .get(`/api/share/${id}`)
      .expect(404);
    expect((response.body as ErrorResponse).message).toBe(
      'Shared analysis is unavailable',
    );
    expect(get).not.toHaveBeenCalled();
  });

  test('unknown, revoked and missing-result links have the same safe response', async () => {
    const key = await persist();
    const created = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(201);
    const createdBody = created.body as ShareResponse;
    const unknown = await request(app.getHttpServer())
      .get('/api/share/AAAAAAAAAAAAAAAAAAAAAA')
      .expect(404);
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${key}/share`)
      .expect(200, { revoked: true });
    const revoked = await request(app.getHttpServer())
      .get(`/api/share/${createdBody.id}`)
      .expect(404);
    const again = await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${key}/share`)
      .expect(200, { revoked: false });
    expect(revoked.body).toEqual(unknown.body);
    expect(again.body).toEqual({ revoked: false });

    const recreated = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(201);
    const recreatedBody = recreated.body as ShareResponse;
    await results.delete(key);
    const missing = await request(app.getHttpServer())
      .get(`/api/share/${recreatedBody.id}`)
      .expect(404);
    expect(missing.body).toEqual(unknown.body);
  });

  test('revoke preserves a result still retained by Recent Analyses', async () => {
    const key = await persist();
    await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(201);
    await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${key}/share`)
      .expect(200, { revoked: true });
    expect(await results.get(key)).toEqual(result);
    expect((await history.list())[0].hasPersistedResult).toBe(true);
  });

  test('storage failures return generic errors without stack or path leakage', async () => {
    const key = await persist();
    const create = jest
      .spyOn(shares, 'create')
      .mockRejectedValueOnce(new Error('C:/private/share-store.json'));
    const failedCreate = await request(app.getHttpServer())
      .post(`/api/analyze/recent/${key}/share`)
      .expect(503);
    create.mockRestore();
    const link = await shares.create(key);
    const open = jest
      .spyOn(shares, 'getResult')
      .mockRejectedValueOnce(new Error('C:/private/result.json.gz'));
    const failedOpen = await request(app.getHttpServer())
      .get(`/api/share/${link!.id}`)
      .expect(503);
    open.mockRestore();
    const revoke = jest
      .spyOn(history, 'revokeShare')
      .mockRejectedValueOnce(new Error('C:/private/share-store.json'));
    const failedRevoke = await request(app.getHttpServer())
      .delete(`/api/analyze/recent/${key}/share`)
      .expect(503);
    revoke.mockRestore();
    const payload = JSON.stringify([
      failedCreate.body,
      failedOpen.body,
      failedRevoke.body,
    ]);
    expect(payload).not.toMatch(/private|\.json|stack/i);
  });
});
