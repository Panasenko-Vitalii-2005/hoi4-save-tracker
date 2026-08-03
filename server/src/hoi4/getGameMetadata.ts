import { open } from 'fs/promises';
import { basename } from 'path';

export interface GameMetadata {
  campaignId: string;
  startDate: string;
  playerTag?: string | null;
  isValid: boolean;
}

export async function getGameMetadata(path: string): Promise<GameMetadata> {
  try {
    const file = await open(path, 'r');
    const buffer = Buffer.alloc(1024 * 10);
    await file.read(buffer, 0, 1024 * 10, 0);
    await file.close();

    const content = buffer.toString('utf8');

    const campaignIdMatch = content.match(
      /(?:game_unique_id|campaign_id)="?([^"\s]+)"?/,
    ); // Поддерживаем оба возможных ключа метаданных
    const startDateMatch = content.match(/date="?([^"\s]+)"?/);
    const playerMatch = content.match(/player="?([A-Z0-9]{3})"?/); // Находит тег игрока (например, GER)

    // Fallback: если не нашли ID в файле, берем имя файла
    const fileName = basename(path, '.hoi4');

    return {
      campaignId: campaignIdMatch ? campaignIdMatch[1] : fileName,
      startDate: startDateMatch ? startDateMatch[1] : 'unknown',
      playerTag: playerMatch ? playerMatch[1] : null, // Добавляем новое поле
      isValid: !!startDateMatch, // Считаем метаданные валидными, если нашли хотя бы дату
    };
  } catch (err) {
    console.error(`Error reading file ${path}:`, err);
    return {
      campaignId: basename(path),
      startDate: 'unknown',
      playerTag: null,
      isValid: false,
    };
  }
}
