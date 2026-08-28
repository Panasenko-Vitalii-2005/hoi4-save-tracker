import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Param,
  Patch,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { LocalSavePathError, resolveLocalSavePath } from '../saves/local-saves';
import { RecentAnalysesService } from './recent-analyses.service';
import type { Response } from 'express';
import { normalizeAnalysisHash } from './persisted-analysis-result.service';

interface AnalyzeRequest {
  path: string;
}

interface UploadedSave {
  path: string;
  originalname: string;
  size: number;
}

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024;
const UPLOAD_DIRECTORY = path.join(os.tmpdir(), 'hoi4-save-tracker');

fs.mkdirSync(UPLOAD_DIRECTORY, { recursive: true });

@Controller('api/analyze')
export class AnalyzeController {
  constructor(
    private readonly analysis: AnalysisResultCacheService,
    private readonly history: RecentAnalysesService,
  ) {}

  @Get('recent')
  async recent() {
    return { items: await this.history.list() };
  }

  @Delete('recent')
  async clearRecent() {
    try {
      await this.history.clear();
      return { items: [] };
    } catch {
      throw new HttpException(
        'Could not clear recent analyses',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('recent/:hash/result')
  async openResult(@Param('hash') hash: string) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    const result = await this.history.getResult(key);
    if (!result)
      throw new HttpException(
        'Saved analysis result is unavailable',
        HttpStatus.NOT_FOUND,
      );
    return result;
  }

  @Delete('recent/:hash')
  async deleteRecent(@Param('hash') hash: string) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    try {
      await this.history.delete(key);
      this.analysis.delete(key);
      return { items: await this.history.list() };
    } catch {
      throw new HttpException(
        'Could not delete the saved analysis',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Patch('recent/:hash')
  async pinRecent(@Param('hash') hash: string, @Body() body: unknown) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('pinned' in body) ||
      typeof body.pinned !== 'boolean'
    )
      throw new HttpException(
        'Provide only a boolean pinned field',
        HttpStatus.BAD_REQUEST,
      );
    let found: boolean;
    try {
      found = await this.history.setPinned(key, body.pinned);
    } catch {
      throw new HttpException(
        'Could not update the saved analysis',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!found)
      throw new HttpException(
        'Recent analysis was not found',
        HttpStatus.NOT_FOUND,
      );
    return { items: await this.history.list() };
  }

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      dest: UPLOAD_DIRECTORY,
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async analyze(
    @Body() body: AnalyzeRequest,
    @Res({ passthrough: true }) response: Response,
    @UploadedFile() uploadedSave?: UploadedSave,
  ) {
    const requestedPath = (body?.path ?? '').trim();

    if (!uploadedSave && !requestedPath) {
      throw new HttpException(
        'Upload a save file or provide a "path" field',
        HttpStatus.BAD_REQUEST,
      );
    }

    let filePath = uploadedSave?.path;
    if (!filePath) {
      try {
        filePath = resolveLocalSavePath(requestedPath);
      } catch (error: unknown) {
        if (error instanceof LocalSavePathError) {
          const status =
            error.code === 'file_not_found' || error.code === 'root_unavailable'
              ? HttpStatus.NOT_FOUND
              : HttpStatus.BAD_REQUEST;
          throw new HttpException(error.message, status);
        }
        throw error;
      }
    }

    try {
      const fileSizeBytes =
        uploadedSave?.size ?? (await fs.promises.stat(filePath)).size;
      const { hash, result } = await this.analysis.analyzeWithHash(filePath);
      // Disconnecting does not cancel shared work or another caller's upload.
      // But a caller who disconnected before success should not refresh history.
      if (!response.destroyed) {
        await this.history.record(
          {
            hash,
            fileName: uploadedSave?.originalname ?? path.basename(filePath),
            fileSizeBytes,
          },
          result,
        );
      }
      return result;
    } catch (e: unknown) {
      if (e instanceof HttpException) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      throw new HttpException(
        `Parse error: ${msg}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      if (uploadedSave) {
        try {
          fs.unlinkSync(uploadedSave.path);
        } catch {
          // The analysis result is still valid if temporary-file cleanup fails.
        }
      }
    }
  }
}
