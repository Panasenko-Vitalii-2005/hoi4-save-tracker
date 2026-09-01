import { ServiceUnavailableException } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { Hoi4AnalysisWorkerService } from './hoi4-analysis-worker.service';
import { analyzeSave, type AnalyzeResult } from './hoi4-parser';
import { EventEmitter } from 'node:events';
import { SaveInputError } from './save-input.error';

class TrackedAnalysisService extends Hoi4AnalysisWorkerService {
  readonly created: Worker[] = [];
  readonly limits: Array<Worker['resourceLimits']> = [];
  script: string | null = null;
  spawnError = false;

  protected createWorker(filePath: string): Worker {
    if (this.spawnError) throw new Error('Cannot create worker');
    const worker =
      this.script === null
        ? super.createWorker(filePath)
        : new Worker(this.script, { eval: true, execArgv: [] });
    this.created.push(worker);
    this.limits.push(worker.resourceLimits);
    return worker;
  }
}

function stable(result: AnalyzeResult) {
  const { parse_seconds, ...rest } = result;
  expect(Number.isFinite(parse_seconds)).toBe(true);
  return rest;
}

function save(shipName: string, country: string): string {
  return `HOI4txt
date="1944.5.1.2"
player="GER"
version="Operation Postern v1.19.2.0.a729 (d245)"
game_unique_id="0731c3c7-035e-46b1-b07b-6c35b27e8dc2"
history={ sunk_ship={
  name="${shipName}" country="${country}" definition="destroyer"
  killer_name="HMS Example" killer_country="ENG" killer_definition="destroyer"
  equipment_variant={ id=1 type=70 } level=1 date="1941.1.19.24"
  location=1 battle={ id=1 type=4713 } convoy=no
} }`;
}

describe('Hoi4AnalysisWorkerService', () => {
  const originalLimit = process.env.HOI4_ANALYSIS_WORKERS;
  const originalTimeout = process.env.HOI4_ANALYSIS_TIMEOUT_MS;
  const directory = mkdtempSync(join(tmpdir(), 'hoi4-worker-test-'));
  const firstPath = join(directory, 'first.hoi4');
  const secondPath = join(directory, 'second.hoi4');
  let service: TrackedAnalysisService;

  beforeAll(() => {
    writeFileSync(firstPath, save('M\u00f6we', 'GER'));
    writeFileSync(secondPath, save('ARM Potos\u00ed', 'MEX'));
  });

  beforeEach(() => {
    delete process.env.HOI4_ANALYSIS_WORKERS;
    delete process.env.HOI4_ANALYSIS_TIMEOUT_MS;
    service = new TrackedAnalysisService();
  });

  afterEach(async () => {
    await service.onModuleDestroy();
    for (const worker of service.created) {
      expect(worker.threadId).toBe(-1);
      expect(worker.listenerCount('message')).toBe(0);
      expect(worker.listenerCount('error')).toBe(0);
      expect(worker.listenerCount('exit')).toBe(0);
    }
  });

  afterAll(() => {
    rmSync(directory, { recursive: true, force: true });
    if (originalLimit === undefined) delete process.env.HOI4_ANALYSIS_WORKERS;
    else process.env.HOI4_ANALYSIS_WORKERS = originalLimit;
    if (originalTimeout === undefined)
      delete process.env.HOI4_ANALYSIS_TIMEOUT_MS;
    else process.env.HOI4_ANALYSIS_TIMEOUT_MS = originalTimeout;
  });

  test('runs the actual parser in a Worker and returns the same semantic result', async () => {
    const result = await service.analyze(firstPath);
    expect(stable(result)).toEqual(stable(analyzeSave(firstPath)));
    expect(result.navalLosses[0].sunkShip.name).toBe('M\u00f6we');
    expect(service.created).toHaveLength(1);
    expect(service.limits[0].maxOldGenerationSizeMb).toBeGreaterThanOrEqual(
      1024,
    );
    // The promise settles only after the Worker exits, not just after its message.
    expect(service.created[0].threadId).toBe(-1);
  });

  test('returns campaign context from the existing Worker decode without a second analysis', async () => {
    const analysis = await service.analyzeWithContext(firstPath);
    expect(analysis.comparisonContext).toEqual({
      campaignId: '0731c3c7-035e-46b1-b07b-6c35b27e8dc2',
      gameVersion: 'Operation Postern v1.19.2.0.a729 (d245)',
      playerCountryTag: 'GER',
    });
    expect(analysis.result.game_date).toBe('1944.5.1');
    expect(service.created).toHaveLength(1);
  });

  test('propagates a nonexistent path error with its parser stack', async () => {
    const failure: unknown = await service
      .analyze(join(directory, 'missing.hoi4'))
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      name: 'Error',
      message: expect.stringContaining('ENOENT') as unknown,
      stack: expect.stringContaining('readSave') as unknown,
    });
  });

  test('propagates a real parser exception for a corrupt compressed save', async () => {
    const corrupt = join(directory, 'corrupt.hoi4');
    writeFileSync(corrupt, Buffer.from('PKinvalid'));
    let directError: unknown;
    try {
      analyzeSave(corrupt);
    } catch (error: unknown) {
      directError = error;
    }
    expect(directError).toBeInstanceOf(Error);
    await expect(service.analyze(corrupt)).rejects.toThrow(
      (directError as Error).message,
    );
  });

  test('handles an uncaught Worker crash', async () => {
    service.script = 'throw new TypeError("worker crash")';
    await expect(service.analyze(firstPath)).rejects.toThrow('worker crash');
  });

  test.each([0, 2])(
    'rejects exit code %i without a result instead of hanging',
    async (code) => {
      service.script = `process.exit(${code})`;
      await expect(service.analyze(firstPath)).rejects.toThrow(
        `exited without a result (code ${code})`,
      );
    },
  );

  test('ignores later messages/exit after success and terminates a lingering worker', async () => {
    const result = analyzeSave(firstPath);
    service.script = `
      const {parentPort}=require('node:worker_threads');
      parentPort.postMessage({ok:true,result:${JSON.stringify(result)}});
      parentPort.postMessage({ok:false,error:{name:'Error',message:'too late'}});
      setInterval(()=>{},1000);
    `;
    await expect(service.analyze(firstPath)).resolves.toEqual(result);
    expect(service.created[0].threadId).toBe(-1);
  });

  test('keeps an already delivered result on a subsequent nonzero exit', async () => {
    const result = analyzeSave(firstPath);
    service.script = `
      require('node:worker_threads').parentPort.postMessage({ok:true,result:${JSON.stringify(result)}});
      process.exit(7);
    `;
    await expect(service.analyze(firstPath)).resolves.toEqual(result);
  });

  test('keeps the first serialized failure, including name and stack', async () => {
    service.script = `
      const {parentPort}=require('node:worker_threads');
      parentPort.postMessage({ok:false,error:{name:'TypeError',message:'first',stack:'original stack'}});
      parentPort.postMessage({ok:true,result:{}});
    `;
    await expect(service.analyze(firstPath)).rejects.toMatchObject({
      name: 'TypeError',
      message: 'first',
      stack: 'original stack',
    });
  });

  test('releases capacity after a failed Worker so a subsequent call succeeds', async () => {
    service.script = 'process.exit(2)';
    await expect(service.analyze(firstPath)).rejects.toThrow('code 2');
    service.script = null;
    await expect(service.analyze(firstPath)).resolves.toMatchObject({
      game_date: '1944.5.1',
    });
  });

  test('does not leak capacity if Worker construction throws', async () => {
    service.spawnError = true;
    await expect(service.analyze(firstPath)).rejects.toThrow('Cannot create');
    service.spawnError = false;
    service.script = 'process.exit(2)';
    await expect(service.analyze(firstPath)).rejects.toThrow('code 2');
  });

  test('limits active workers to one by default and rejects excess calls without spawning', async () => {
    service.script = 'setInterval(()=>{},1000)';
    const first = expect(service.analyze(firstPath)).rejects.toThrow(
      'exited without a result',
    );
    for (let index = 0; index < 4; index++) {
      await expect(service.analyze(firstPath)).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    }
    expect(service.created).toHaveLength(1);
    await service.onModuleDestroy();
    await first;
    await expect(service.analyze(firstPath)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  test('runs two actual analyses concurrently with isolated parser state when configured', async () => {
    process.env.HOI4_ANALYSIS_WORKERS = '2';
    service = new TrackedAnalysisService();
    const [first, second] = await Promise.all([
      service.analyze(firstPath),
      service.analyze(secondPath),
    ]);
    expect(stable(first)).toEqual(stable(analyzeSave(firstPath)));
    expect(stable(second)).toEqual(stable(analyzeSave(secondPath)));
    expect(first.navalLosses[0].sunkShip.name).toBe('M\u00f6we');
    expect(second.navalLosses[0].sunkShip.name).toBe('ARM Potos\u00ed');
    expect(service.created).toHaveLength(2);
  });

  test.each(['0', '-1', '1.5', 'abc', 'Infinity', ''])(
    'rejects invalid concurrency configuration %j',
    (limit) => {
      process.env.HOI4_ANALYSIS_WORKERS = limit;
      expect(() => new Hoi4AnalysisWorkerService()).toThrow('positive integer');
    },
  );

  test('hard deadline terminates a real looping Worker, releases its slot and allows retry', async () => {
    process.env.HOI4_ANALYSIS_TIMEOUT_MS = '150';
    service = new TrackedAnalysisService();
    service.script = 'while(true) {}';
    const started = Date.now();
    await expect(service.analyze(firstPath)).rejects.toMatchObject({
      code: 'ANALYSIS_TIMEOUT',
    });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(service.created[0].threadId).toBe(-1);
    const result = analyzeSave(firstPath);
    service.script = `require('node:worker_threads').parentPort.postMessage({ok:true,result:${JSON.stringify(result)}})`;
    await expect(service.analyze(firstPath)).resolves.toEqual(result);
  });

  test.each(['result-first', 'timeout-first', 'error-first'])(
    'settles exactly once and cleans all listeners/timers for %s race',
    async (order) => {
      jest.useFakeTimers();
      process.env.HOI4_ANALYSIS_TIMEOUT_MS = '100';
      const stub = new EventEmitter() as EventEmitter & {
        terminate: jest.Mock;
        threadId: number;
      };
      stub.threadId = 1;
      let terminated!: () => void;
      stub.terminate = jest.fn(
        () =>
          new Promise<number>((resolve) => {
            terminated = () => {
              stub.threadId = -1;
              resolve(0);
            };
          }),
      );
      class StubService extends Hoi4AnalysisWorkerService {
        protected createWorker() {
          return stub as unknown as Worker;
        }
      }
      const subject = new StubService();
      try {
        const result = analyzeSave(firstPath);
        const done = jest.fn();
        const pending = subject.analyze(firstPath).then(
          (value) => {
            done();
            return value;
          },
          (error: unknown) => {
            done();
            return error;
          },
        );
        if (order === 'result-first')
          stub.emit('message', { ok: true, result });
        else if (order === 'error-first')
          stub.emit('error', new Error('first crash'));
        jest.advanceTimersByTime(100);
        stub.emit('message', { ok: true, result });
        stub.emit('error', new Error('late failure'));
        stub.emit('exit', 2);
        expect(stub.terminate).toHaveBeenCalledTimes(1);
        terminated();
        const outcome = await pending;
        expect(done).toHaveBeenCalledTimes(1);
        if (order === 'result-first') expect(outcome).toEqual(result);
        else if (order === 'timeout-first')
          expect(outcome).toEqual(new SaveInputError('ANALYSIS_TIMEOUT'));
        else expect(outcome).toEqual(new Error('first crash'));
        expect(jest.getTimerCount()).toBe(0);
        expect(
          stub.listenerCount('message') +
            stub.listenerCount('exit') +
            stub.listenerCount('error'),
        ).toBe(0);
      } finally {
        await subject.onModuleDestroy();
        jest.useRealTimers();
      }
    },
  );
});
