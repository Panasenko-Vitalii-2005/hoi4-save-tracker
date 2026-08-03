import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { SaveAnalysisService } from './hoi4/save-analysis.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [SaveAnalysisService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('POST /saves/analyze', () => {
    it('should throw BadRequestException for empty paths', async () => {
      await expect(appController.analyze({ paths: [] } as any)).rejects.toThrow(
        'Paths must be a non-empty array',
      );
    });
  });
});
