import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import AdmZip from 'adm-zip';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { App } from 'supertest/types';
import { AnalyzeController } from './analyze.controller';

const MOWE = 'M\u00f6we';
const POTOSI = 'ARM Potos\u00ed';
const UPLOAD_DIRECTORY = join(tmpdir(), 'hoi4-save-tracker');

interface AnalyzeResponse {
  game_date: string;
  navalLosses: Array<{ sunkShip: { name: string } }>;
  stockpileSummaries: unknown[];
}

function navalSave(shipName: string): string {
  return `HOI4txt
date="1944.5.1.2"
history={
  sunk_ship={
    name="${shipName}"
    killer_name="HMS Example"
    country="GER"
    killer_country="ENG"
    definition="destroyer"
    killer_definition="destroyer"
    level=1
    equipment_variant={ id=1 type=70 }
    date="1941.1.19.24"
    location=1
    battle={ id=1 type=4713 }
    convoy=no
  }
}`;
}

describe('AnalyzeController uploads', () => {
  let app: INestApplication<App>;
  const originalRoot = process.env.HOI4_SAVES_DIR;
  const localSaveRoot = mkdtempSync(join(tmpdir(), 'hoi4-local-analyze-'));

  beforeAll(async () => {
    process.env.HOI4_SAVES_DIR = localSaveRoot;
    const moduleRef = await Test.createTestingModule({
      controllers: [AnalyzeController],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    rmSync(localSaveRoot, { recursive: true, force: true });
    if (originalRoot === undefined) delete process.env.HOI4_SAVES_DIR;
    else process.env.HOI4_SAVES_DIR = originalRoot;
  });

  test.each([
    ['plain', Buffer.from(navalSave(MOWE), 'utf8'), MOWE],
    [
      'compressed',
      (() => {
        const zip = new AdmZip();
        zip.addFile('gamestate', Buffer.from(navalSave(POTOSI), 'utf8'));
        return zip.toBuffer();
      })(),
      POTOSI,
    ],
  ])(
    'analyzes and removes a %s uploaded save',
    async (_kind, payload, name) => {
      const existingUploads = readdirSync(UPLOAD_DIRECTORY).sort();
      const response = await request(app.getHttpServer())
        .post('/api/analyze')
        .attach('file', payload, 'fixture.hoi4')
        .expect(201);
      const body = response.body as AnalyzeResponse;

      expect(body.game_date).toBe('1944.5.1');
      expect(body.navalLosses[0].sunkShip.name).toBe(name);
      expect(body.stockpileSummaries).toEqual([]);
      expect(readdirSync(UPLOAD_DIRECTORY).sort()).toEqual(existingUploads);
    },
  );

  test('preserves the existing JSON path request', async () => {
    const savePath = join(localSaveRoot, 'fixture.hoi4');
    writeFileSync(savePath, Buffer.from(navalSave(MOWE), 'utf8'));

    const response = await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: savePath })
      .expect(201);
    const body = response.body as AnalyzeResponse;

    expect(body.navalLosses[0].sunkShip.name).toBe(MOWE);
    expect(body.stockpileSummaries).toEqual([]);
    expect(existsSync(savePath)).toBe(true);
  });

  test('rejects path traversal outside the configured save root', async () => {
    await request(app.getHttpServer())
      .post('/api/analyze')
      .send({ path: '../outside.hoi4' })
      .expect(400);
  });

  test('rejects an absolute path outside the configured save root', async () => {
    const outsideDirectory = mkdtempSync(join(tmpdir(), 'hoi4-outside-'));
    const outsideSave = join(outsideDirectory, 'outside.hoi4');
    writeFileSync(outsideSave, Buffer.from(navalSave(MOWE), 'utf8'));

    try {
      await request(app.getHttpServer())
        .post('/api/analyze')
        .send({ path: outsideSave })
        .expect(400);
    } finally {
      rmSync(outsideDirectory, { recursive: true, force: true });
    }
  });
});
