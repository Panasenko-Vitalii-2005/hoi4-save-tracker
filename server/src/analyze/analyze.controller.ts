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
  Req,
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
import type { Request, Response } from 'express';
import { normalizeAnalysisHash } from './persisted-analysis-result.service';
import { AnalysisComparisonService } from './analysis-comparison.service';
import type { AnalysisComparisonDto } from './analysis-comparison.types';
import { SaveUploadInterceptor } from './save-upload.interceptor';
import { validateSaveFileFormat } from '../hoi4/save-container';
import { SaveInputError } from '../hoi4/save-input.error';
import { LocalSaveInput } from '../auth/route-access.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SafeUserDto } from '../auth/auth.types';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import { UserAnalysesService } from './user-analyses.service';
import type {
  AnalysisMetadataInput,
  AnalysisSaveFormat,
  AnalysisTelemetryCarrier,
} from '../telemetry/product-events.types';

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
    private readonly ownership: AnalysisOwnershipService,
    private readonly userAnalyses: UserAnalysesService,
  ) {}

  @Get('compare')
  async compare(
    @CurrentUser() currentUser: SafeUserDto,
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
      if (
        !(await this.ownership.hasAllOwnership(currentUser.id, [
          baseHash,
          targetHash,
        ]))
      )
        throw new HttpException(
          'One or both saved analysis results are unavailable',
          HttpStatus.NOT_FOUND,
        );
      result = await this.comparison.compare(baseHash, targetHash);
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
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
  async recent(@CurrentUser() currentUser: SafeUserDto) {
    try {
      return { items: await this.userAnalyses.list(currentUser.id) };
    } catch {
      throw new HttpException(
        'Could not load recent analyses',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('storage')
  async storage(@CurrentUser() currentUser: SafeUserDto) {
    try {
      return await this.userAnalyses.storageStatus(currentUser.id);
    } catch {
      throw new HttpException(
        'Could not read local analysis storage',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Delete('storage/unpinned')
  async deleteUnpinned(@CurrentUser() currentUser: SafeUserDto) {
    try {
      const deleted = await this.userAnalyses.deleteUnpinned(currentUser.id);
      return {
        deletedCount: deleted.length,
        items: await this.userAnalyses.list(currentUser.id),
        storage: await this.userAnalyses.storageStatus(currentUser.id),
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
    @CurrentUser() currentUser: SafeUserDto,
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
      const deleted = await this.userAnalyses.deleteCampaign(
        currentUser.id,
        key,
        body.includePinned,
      );
      return {
        deletedCount: deleted.length,
        items: await this.userAnalyses.list(currentUser.id),
        storage: await this.userAnalyses.storageStatus(currentUser.id),
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
  async clearRecent(@CurrentUser() currentUser: SafeUserDto) {
    try {
      await this.userAnalyses.clear(currentUser.id);
      return { items: [] };
    } catch {
      throw new HttpException(
        'Could not clear recent analyses',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('recent/:hash/result')
  async openResult(
    @CurrentUser() currentUser: SafeUserDto,
    @Param('hash') hash: string,
  ) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    let result: Awaited<ReturnType<UserAnalysesService['getResult']>>;
    try {
      result = await this.userAnalyses.getResult(currentUser.id, key);
    } catch {
      throw new HttpException(
        'Could not load the saved analysis',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!result)
      throw new HttpException(
        'Saved analysis result is unavailable',
        HttpStatus.NOT_FOUND,
      );
    return result;
  }

  @Delete('recent/:hash')
  async deleteRecent(
    @CurrentUser() currentUser: SafeUserDto,
    @Param('hash') hash: string,
  ) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    try {
      const found = await this.userAnalyses.delete(currentUser.id, key);
      if (!found)
        throw new HttpException(
          'Saved analysis result is unavailable',
          HttpStatus.NOT_FOUND,
        );
      return { items: await this.userAnalyses.list(currentUser.id) };
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Could not delete the saved analysis',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Patch('recent/:hash')
  async pinRecent(
    @CurrentUser() currentUser: SafeUserDto,
    @Param('hash') hash: string,
    @Body() body: unknown,
  ) {
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
      found = await this.userAnalyses.setPinned(
        currentUser.id,
        key,
        body.pinned,
      );
    } catch {
      throw new HttpException(
        'Could not update the saved analysis',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!found)
      throw new HttpException(
        'Saved analysis result is unavailable',
        HttpStatus.NOT_FOUND,
      );
    return { items: await this.userAnalyses.list(currentUser.id) };
  }

  @Post()
  @LocalSaveInput()
  @UseInterceptors(SaveUploadInterceptor)
  async analyze(
    @CurrentUser() currentUser: SafeUserDto,
    @Body() body: AnalyzeRequest,
    @Res({ passthrough: true }) response: Response,
    @UploadedFile() uploadedSave?: UploadedSave,
    @Query('response') responseMode?: unknown,
    @Req() request?: Request & AnalysisTelemetryCarrier,
  ) {
    const attempt = request?.productAnalysisAttempt;
    if (attempt) {
      attempt.stage = 'validation';
      if (uploadedSave) attempt.fileSizeBytes = uploadedSave.size;
    }
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

    const saveFormat = await validateSaveFileFormat(filePath);
    const fileSizeBytes =
      uploadedSave?.size ?? (await fs.promises.stat(filePath)).size;
    if (attempt) {
      attempt.fileSizeBytes = fileSizeBytes;
      attempt.saveFormat = saveFormat;
      attempt.stage = 'analysis';
    }
    const { hash, result, comparisonContext } =
      await this.analysis.analyzeWithHash(filePath);
    if (attempt)
      attempt.analysis = this.analysisMetadata(
        hash,
        fileSizeBytes,
        saveFormat,
        result,
      );
    const record = {
      hash,
      fileName: uploadedSave?.originalname ?? path.basename(filePath),
      fileSizeBytes,
    };
    // The interceptor owns cleanup, including pre-controller failures and disconnects.
    let persisted = false;
    if (attempt) attempt.stage = 'persistence';
    if (!response.destroyed) {
      persisted = await this.history.record(
        record,
        result,
        comparisonContext,
        () => this.assignOwnership(currentUser, hash, record.fileName),
      );
    }
    if (responseMode === 'batch') {
      if (!persisted) throw new SaveInputError('PERSISTENCE_FAILED');
      return {
        hash,
        gameDate: result.game_date,
        campaignId: comparisonContext.campaignId,
      };
    }
    if (!response.destroyed) response.setHeader('X-Analysis-Hash', hash);
    return result;
  }

  private analysisMetadata(
    contentHash: string,
    fileSizeBytes: number,
    saveFormat: AnalysisSaveFormat,
    result: Awaited<ReturnType<AnalysisResultCacheService['analyze']>>,
  ): AnalysisMetadataInput {
    return {
      contentHash,
      fileSizeBytes,
      parseDurationMs: Math.max(0, Math.round(result.parse_seconds * 1000)),
      divisionCount: result.totals.divisions,
      saveFormat,
    };
  }

  private async assignOwnership(
    currentUser: SafeUserDto,
    hash: string,
    fileName: string,
  ): Promise<void> {
    try {
      await this.ownership.ensureOwnership(currentUser.id, hash, { fileName });
    } catch {
      throw new HttpException(
        'Could not record analysis ownership',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
