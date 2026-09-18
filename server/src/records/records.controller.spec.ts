import type { DatabaseService } from '../database/database.service';
import { HealthController } from './records.controller';

describe('HealthController', () => {
  test.each(['disabled', 'ok', 'unavailable'] as const)(
    'reports the compact database state %s without diagnostics',
    async (database) => {
      const service = {
        health: jest.fn().mockResolvedValue(database),
      } as unknown as DatabaseService;
      const controller = new HealthController(service);
      const status = jest.fn();

      await expect(
        controller.health({ status } as unknown as import('express').Response),
      ).resolves.toEqual({
        status: database === 'unavailable' ? 'unavailable' : 'ok',
        database,
      });
      expect(status).toHaveBeenCalledTimes(database === 'unavailable' ? 1 : 0);
      if (database === 'unavailable') expect(status).toHaveBeenCalledWith(503);
    },
  );

  test.each([
    ['ok', 'ok', 0],
    ['disabled', 'unavailable', 1],
    ['unavailable', 'unavailable', 1],
  ] as const)(
    'maps database state %s to generic readiness state %s',
    async (database, readiness, statusCalls) => {
      const service = {
        health: jest.fn().mockResolvedValue(database),
      } as unknown as DatabaseService;
      const controller = new HealthController(service);
      const status = jest.fn();

      await expect(
        controller.readiness({
          status,
        } as unknown as import('express').Response),
      ).resolves.toEqual({ status: readiness });
      expect(status).toHaveBeenCalledTimes(statusCalls);
      if (statusCalls > 0) expect(status).toHaveBeenCalledWith(503);
    },
  );
});
