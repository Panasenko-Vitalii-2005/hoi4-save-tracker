import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { SaveAnalysisService } from './hoi4/save-analysis.service';

describe('AppController', () => {
  let appController: AppController;
  const analyzeSaves = jest.fn();
  const originalEnabled = process.env.HOI4_LOCAL_SAVES_ENABLED;

  beforeEach(async () => {
    process.env.HOI4_LOCAL_SAVES_ENABLED = 'true';
    analyzeSaves.mockReset();
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: SaveAnalysisService, useValue: { analyzeSaves } }],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  afterEach(() => {
    if (originalEnabled === undefined)
      delete process.env.HOI4_LOCAL_SAVES_ENABLED;
    else process.env.HOI4_LOCAL_SAVES_ENABLED = originalEnabled;
  });

  describe('POST /saves/analyze', () => {
    it('should throw BadRequestException for empty paths', async () => {
      await expect(appController.analyze([])).rejects.toThrow(
        'Paths must be a non-empty array',
      );
    });

    it.each([undefined, 'false'])(
      'does not invoke filesystem analysis when local saves are %s',
      async (enabled) => {
        if (enabled === undefined) delete process.env.HOI4_LOCAL_SAVES_ENABLED;
        else process.env.HOI4_LOCAL_SAVES_ENABLED = enabled;

        await expect(
          appController.analyze(['C:\\private\\save.hoi4']),
        ).rejects.toMatchObject({ status: 404 });
        expect(analyzeSaves).not.toHaveBeenCalled();
      },
    );

    it('preserves legacy local analysis when explicitly enabled', async () => {
      analyzeSaves.mockResolvedValueOnce([{ campaignId: 'campaign' }]);

      await expect(appController.analyze(['save.hoi4'])).resolves.toEqual([
        { campaignId: 'campaign' },
      ]);
      expect(analyzeSaves).toHaveBeenCalledWith(['save.hoi4']);
    });
  });
});
