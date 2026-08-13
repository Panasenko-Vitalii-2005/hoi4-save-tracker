import { Controller, Get } from '@nestjs/common';
import * as fs from 'fs';
import { getLocalSavesRoot, resolveLocalSavePath } from './local-saves';

export interface SaveFileInfo {
  name: string;
  path: string;
  size_mb: number;
  modified: string;
}

@Controller('api/saves')
export class SavesController {
  @Get()
  listSaves(): {
    dir: string;
    exists: boolean;
    files: SaveFileInfo[];
  } {
    const scanDir = getLocalSavesRoot();

    if (!fs.existsSync(scanDir) || !fs.statSync(scanDir).isDirectory()) {
      return { dir: scanDir, exists: false, files: [] };
    }

    let files: SaveFileInfo[] = [];
    try {
      files = fs
        .readdirSync(scanDir)
        .filter((name) => name.toLowerCase().endsWith('.hoi4'))
        .map((name) => {
          try {
            const full = resolveLocalSavePath(name);
            const stat = fs.statSync(full);
            return {
              name,
              path: full,
              size_mb: Math.round((stat.size / 1_048_576) * 100) / 100,
              modified: stat.mtime.toISOString(),
            };
          } catch {
            return null;
          }
        })
        .filter((file): file is SaveFileInfo => file !== null)
        .sort((left, right) => right.modified.localeCompare(left.modified));
    } catch {
      return { dir: scanDir, exists: false, files: [] };
    }

    return { dir: scanDir, exists: true, files };
  }

  @Get('default-dir')
  defaultDir(): { dir: string; exists: boolean } {
    const dir = getLocalSavesRoot();
    return {
      dir,
      exists: fs.existsSync(dir) && fs.statSync(dir).isDirectory(),
    };
  }
}
