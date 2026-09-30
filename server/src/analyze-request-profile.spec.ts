import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import {
  analyzeRequestProfileMiddleware,
  currentAnalyzeRequestProfile,
  profileRequestPhase,
  profileRequestSync,
} from './analyze-request-profile';

interface Summary {
  requestId: string;
  phases: Record<string, number | null>;
  backendTotalMs: number;
  responseFinishedMs: number | null;
  responseBytes: number | null;
  outcome: string;
  errorCode: string | null;
}

describe('Opt-in analyze HTTP request profiling', () => {
  const previous = process.env.HOI4_REQUEST_PROFILE;
  let log: jest.SpyInstance<void, unknown[]>;
  beforeEach(() => {
    process.env.HOI4_REQUEST_PROFILE = '1';
    log = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.HOI4_REQUEST_PROFILE;
    else process.env.HOI4_REQUEST_PROFILE = previous;
    jest.restoreAllMocks();
  });
  function exchange(method = 'POST', url = '/api/analyze') {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 201,
      writableFinished: false,
      getHeader: () => '123',
      json: jest.fn<unknown, [unknown]>(() => null),
    });
    response.json.mockReturnValue(response);
    const request = { method, originalUrl: url } as Request;
    return { request, response, http: response as unknown as Response };
  }
  const summary = () =>
    JSON.parse(
      (log.mock.calls[0][0] as string).replace(
        '[REQUEST_PROFILE] analyze ',
        '',
      ),
    ) as Summary;

  test.each([undefined, '0', 'true'])('disabled (%s) is a no-op', (flag) => {
    if (flag === undefined) delete process.env.HOI4_REQUEST_PROFILE;
    else process.env.HOI4_REQUEST_PROFILE = flag;
    const { request, response, http } = exchange();
    const json = response.json;
    const next = jest.fn(() => {
      expect(currentAnalyzeRequestProfile()).toBeUndefined();
    });
    analyzeRequestProfileMiddleware(request, http, next);
    response.emit('finish');
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.json).toBe(json);
    expect(log).not.toHaveBeenCalled();
  });

  test.each([
    ['GET', '/api/analyze'],
    ['POST', '/api/analyze/batch/preflight'],
    ['POST', '/api/analyze/recent'],
  ])('does not profile unrelated route %s %s', (method, url) => {
    const { request, response, http } = exchange(method, url);
    analyzeRequestProfileMiddleware(request, http, () => {});
    response.emit('finish');
    expect(log).not.toHaveBeenCalled();
  });

  test('records JSON preparation and emits only on finish, once', async () => {
    const { request, response, http } = exchange('POST', '/api/analyze?mode=x');
    const originalJson = response.json;
    const body = { data: ['unchanged'] };
    analyzeRequestProfileMiddleware(request, http, () => {
      profileRequestSync('validationMs', () => 1);
      expect(http.json(body)).toBe(response);
    });
    expect(originalJson).toHaveBeenCalledWith(body);
    expect(log).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 25));
    response.writableFinished = true;
    response.emit('finish');
    response.emit('close');
    response.emit('finish');
    expect(log).toHaveBeenCalledTimes(1);
    expect(summary()).toMatchObject({
      outcome: 'completed',
      responseBytes: 123,
      errorCode: null,
    });
    expect(summary().backendTotalMs).toBeGreaterThanOrEqual(20);
    expect(summary().responseFinishedMs).toBe(summary().backendTotalMs);
    expect(summary().phases.responsePreparationMs).toEqual(expect.any(Number));
    expect(summary().phases.workerMs).toBeNull();
  });

  test('client close produces one bounded abort with no false finish', () => {
    const { request, response, http } = exchange();
    analyzeRequestProfileMiddleware(request, http, () => {});
    response.emit('close');
    response.emit('finish');
    expect(log).toHaveBeenCalledTimes(1);
    expect(summary()).toMatchObject({
      outcome: 'aborted',
      responseFinishedMs: null,
    });
  });

  test('non-numeric response size remains unavailable', () => {
    const { request, response, http } = exchange();
    response.getHeader = () => 'not-a-length';
    response.statusCode = 403;
    analyzeRequestProfileMiddleware(request, http, () => {});
    response.emit('finish');
    expect(summary()).toMatchObject({
      responseBytes: null,
      outcome: 'failed',
      errorCode: 'HTTP_403',
    });
  });

  test('concurrent async contexts stay isolated and exceptions are unchanged', async () => {
    const first = exchange();
    const second = exchange();
    let firstId: string | undefined;
    let secondId: string | undefined;
    let firstWork!: Promise<void>;
    let secondWork!: Promise<void>;
    const error = new Error('sensitive internal exception');
    analyzeRequestProfileMiddleware(first.request, first.http, () => {
      firstId = currentAnalyzeRequestProfile()?.requestId;
      firstWork = profileRequestPhase('validationMs', async () => {
        await Promise.resolve();
        expect(currentAnalyzeRequestProfile()?.requestId).toBe(firstId);
        throw error;
      });
    });
    analyzeRequestProfileMiddleware(second.request, second.http, () => {
      secondId = currentAnalyzeRequestProfile()?.requestId;
      secondWork = profileRequestPhase('sha256Ms', async () => {
        await Promise.resolve();
        expect(currentAnalyzeRequestProfile()?.requestId).toBe(secondId);
      });
    });
    await expect(firstWork).rejects.toBe(error);
    await secondWork;
    expect(firstId).not.toBe(secondId);
    expect(currentAnalyzeRequestProfile()).toBeUndefined();
    first.response.emit('finish');
    second.response.emit('finish');
    expect(log).toHaveBeenCalledTimes(2);
    expect(summary().phases.validationMs).toEqual(expect.any(Number));
    expect(summary().phases.sha256Ms).toBeNull();
    expect(JSON.stringify(log.mock.calls)).not.toContain(error.message);
  });
});
