import { getGameMetadata } from './getGameMetadata';
import * as fs from 'fs/promises';

jest.mock('fs/promises');

describe('getGameMetadata', () => {
  it('should parse valid HOI4 metadata correctly', async () => {
    const mockContent = 'HOI4txt\ncampaign_id="abc123"\ndate="1936.1.1"';

    // Мокаем открытие файла
    (fs.open as any).mockResolvedValue({
      read: (buffer: Buffer) => {
        buffer.write(mockContent);
        return { bytesRead: mockContent.length };
      },
      close: jest.fn(),
    });

    const result = await getGameMetadata('fake-path.hoi4');
    expect(result).toEqual({
      campaignId: 'abc123',
      startDate: '1936.1.1',
      playerTag: null,
      isValid: true,
    });
  });
});
