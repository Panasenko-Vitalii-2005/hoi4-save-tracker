import { Controller, Get } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

// __dirname in ts-node dev = server/src/records/  →  3 levels up to project root
const DATA_FILE = path.join(__dirname, '..', '..', '..', 'data', 'autosave_intervals.json');

interface SaveRecord {
  real_time: string;
  game_date: string | null;
  soldiers_by_country?: Record<string, unknown> | null;
  [key: string]: unknown;
}

interface Payload {
  records: SaveRecord[];
  last_updated?: string;
}

function readData(): Payload {
  if (!fs.existsSync(DATA_FILE)) return { records: [] };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8')) as Payload;
  } catch {
    return { records: [] };
  }
}

// ── /api/records ────────────────────────────────────────────

@Controller('api/records')
export class RecordsController {
  @Get()
  getRecords(): Payload {
    return readData();
  }
}

// ── /api/soldiers ───────────────────────────────────────────

interface SoldiersEntry {
  divisions: number;
  manpower: number;
  avg_manpower: number;
}

@Controller('api/soldiers')
export class SoldiersController {
  @Get()
  getSoldiers() {
    const { records } = readData();

    const allTags = new Set<string>();
    for (const rec of records) {
      const sbc = rec.soldiers_by_country;
      if (sbc && typeof sbc === 'object')
        for (const tag of Object.keys(sbc)) allTags.add(tag);
    }

    const timeline = records.map((rec) => {
      const entry: Record<string, unknown> = {
        game_date: rec.game_date,
        real_time: rec.real_time,
      };
      const sbc = (rec.soldiers_by_country ?? {}) as Record<string, SoldiersEntry>;
      for (const tag of allTags) {
        entry[tag] = sbc[tag] ?? { divisions: 0, manpower: 0, avg_manpower: 0 };
      }
      return entry;
    });

    let latestSbc: Record<string, SoldiersEntry> = {};
    for (let i = records.length - 1; i >= 0; i--) {
      const sbc = records[i].soldiers_by_country as Record<string, SoldiersEntry>;
      if (sbc && Object.keys(sbc).length > 0) { latestSbc = sbc; break; }
    }

    const latestRanked = Object.entries(latestSbc)
      .map(([tag, v]) => ({ tag, ...v }))
      .sort((a, b) => b.manpower - a.manpower);

    return {
      tags: [...allTags].sort(),
      timeline,
      latest_ranked: latestRanked,
    };
  }
}

// ── /api/health ─────────────────────────────────────────────

@Controller('api/health')
export class HealthController {
  @Get()
  health() {
    return { status: 'ok' };
  }
}
