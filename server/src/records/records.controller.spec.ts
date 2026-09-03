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

      await expect(controller.health()).resolves.toEqual({
        status: 'ok',
        database,
      });
    },
  );
});
