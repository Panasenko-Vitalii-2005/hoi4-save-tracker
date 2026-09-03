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
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { AnalysisResultCacheService } from '../hoi4/analysis-result-cache.service';
import { LocalSavePathError, resolveLocalSavePath } from '../saves/local-saves';
import { requireLocalSavesEnabled } from '../saves/local-saves-access';
import {
  normalizeCampaignId,
  PinnedCampaignAnalysesError,
  RecentAnalysesService,
} from './recent-analyses.service';
import type { Response } from 'express';
import { normalizeAnalysisHash } from './persisted-analysis-result.service';
import { AnalysisComparisonService } from './analysis-comparison.service';
import type { AnalysisComparisonDto } from './analysis-comparison.types';
import { SaveUploadInterceptor } from './save-upload.interceptor';
import { validateSaveFile } from '../hoi4/save-container';
import { SaveInputError } from '../hoi4/save-input.error';

interface AnalyzeRequest {
  path: string;
}

interface UploadedSave {
  path: string;
  originalname: string;
  size: number;
}

@Controller('api/analyze')
export class AnalyzeController {
  constructor(
    private readonly analysis: AnalysisResultCacheService,
    private readonly history: RecentAnalysesService,
    private readonly comparison: AnalysisComparisonService,
  ) {}

  @Get('compare')
  async compare(
    @Query('base') base: unknown,
    @Query('target') target: unknown,
  ) {
    const baseHash =
      typeof base === 'string' ? normalizeAnalysisHash(base) : null;
    const targetHash =
      typeof target === 'string' ? normalizeAnalysisHash(target) : null;
    if (!baseHash || !targetHash)
      throw new HttpException(
        'Provide valid base and target analysis hashes',
        HttpStatus.BAD_REQUEST,
      );
    let result: AnalysisComparisonDto | null;
    try {
      result = await this.comparison.compare(baseHash, targetHash);
    } catch {
      throw new HttpException(
        'Could not compare saved analyses',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!result)
      throw new HttpException(
        'One or both saved analysis results are unavailable',
        HttpStatus.NOT_FOUND,
      );
    return result;
  }

  @Get('recent')
  async recent() {
    return { items: await this.history.list() };
  }

  @Get('storage')
  async storage() {
    try {
      return await this.history.storageStatus();
    } catch {
      throw new HttpException(
        'Could not read local analysis storage',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Delete('storage/unpinned')
  async deleteUnpinned() {
    try {
      const deleted = await this.history.deleteUnpinned();
      for (const hash of deleted) this.analysis.delete(hash);
      return {
        deletedCount: deleted.length,
        items: await this.history.list(),
        storage: await this.history.storageStatus(),
      };
    } catch {
      throw new HttpException(
        'Could not delete unpinned analyses',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Delete('storage/campaign/:campaignId')
  async deleteCampaign(
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
  ) {
    const key = normalizeCampaignId(campaignId);
    if (!key)
      throw new HttpException('Invalid campaign id', HttpStatus.BAD_REQUEST);
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('includePinned' in body) ||
      typeof body.includePinned !== 'boolean'
    )
      throw new HttpException(
        'Provide only a boolean includePinned field',
        HttpStatus.BAD_REQUEST,
      );
    try {
      const deleted = await this.history.deleteCampaign(
        key,
        body.includePinned,
      );
      for (const hash of deleted) this.analysis.delete(hash);
      return {
        deletedCount: deleted.length,
        items: await this.history.list(),
        storage: await this.history.storageStatus(),
      };
    } catch (error: unknown) {
      if (error instanceof PinnedCampaignAnalysesError)
        throw new HttpException(
          {
            code: 'PINNED_ANALYSES_INCLUDED',
            message: 'Campaign includes pinned analyses',
            pinnedCount: error.pinnedCount,
          },
          HttpStatus.CONFLICT,
        );
      throw new HttpException(
        'Could not delete campaign analyses',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
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
  @UseInterceptors(SaveUploadInterceptor)
  async analyze(
    @Body() body: AnalyzeRequest,
    @Res({ passthrough: true }) response: Response,
    @UploadedFile() uploadedSave?: UploadedSave,
    @Query('response') responseMode?: unknown,
  ) {
    const requestedPath =
      typeof body?.path === 'string' ? body.path.trim() : '';

    if (!uploadedSave && !requestedPath) {
      throw new HttpException(
        'Upload a save file or provide a "path" field',
        HttpStatus.BAD_REQUEST,
      );
    }

    let filePath = uploadedSave?.path;
    if (!filePath) {
      requireLocalSavesEnabled();
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

    await validateSaveFile(filePath);
    const fileSizeBytes =
      uploadedSave?.size ?? (await fs.promises.stat(filePath)).size;
    const { hash, result, comparisonContext } =
      await this.analysis.analyzeWithHash(filePath);
    // The interceptor owns cleanup, including pre-controller failures and disconnects.
    let persisted = false;
    if (!response.destroyed) {
      const record = {
        hash,
        fileName: uploadedSave?.originalname ?? path.basename(filePath),
        fileSizeBytes,
      };
      if (responseMode === 'batch') {
        persisted = await this.history.recordWithStatus(
          record,
          result,
          comparisonContext,
        );
      } else {
        await this.history.record(record, result, comparisonContext);
      }
    }
    if (responseMode === 'batch') {
      if (!persisted) throw new SaveInputError('PERSISTENCE_FAILED');
      return {
        hash,
        gameDate: result.game_date,
        campaignId: comparisonContext.campaignId,
      };
    }
    return result;
  }
}
