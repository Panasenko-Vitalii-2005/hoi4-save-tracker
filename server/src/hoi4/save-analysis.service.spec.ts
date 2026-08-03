import { SaveAnalysisService } from './save-analysis.service';
import * as MetadataModule from './getGameMetadata';

// Re-export for integration tests
// eslint-disable-next-line jest/no-export
export { SaveAnalysisService };

describe('SaveAnalysisService', () => {
  let service: SaveAnalysisService;

  beforeEach(() => {
    service = new SaveAnalysisService();
  });

  it('should group saves by campaignId', async () => {
    // Мокаем metadata, чтобы возвращала разные campaignId
    jest
      .spyOn(MetadataModule, 'getGameMetadata')
      .mockImplementation(async (path: string) => ({
        campaignId: path.includes('session1') ? 'ID_1' : 'ID_2',
        startDate: '1936.1.1',
        isValid: true,
      }));

    const filePaths = [
      'path/to/session1_a.hoi4',
      'path/to/session1_b.hoi4',
      'path/to/session2.hoi4',
    ];
    const result = await service.analyzeSaves(filePaths);

    expect(result).toHaveLength(2); // Две группы
    expect(result.find((r) => r.sessionId === 'ID_1')?.saves).toHaveLength(2);
    expect(result.find((r) => r.sessionId === 'ID_2')?.saves).toHaveLength(1);
  });
});
