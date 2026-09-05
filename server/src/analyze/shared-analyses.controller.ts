import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { normalizeAnalysisHash } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import {
  normalizeShareId,
  SharedAnalysesService,
  SharedAnalysisLimitError,
} from './shared-analyses.service';
import { Public } from '../auth/route-access.decorator';

@Controller()
export class SharedAnalysesController {
  constructor(
    private readonly shares: SharedAnalysesService,
    private readonly history: RecentAnalysesService,
  ) {}

  @Post('api/analyze/recent/:hash/share')
  async create(@Param('hash') hash: string) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    try {
      const link = await this.shares.create(key);
      if (!link)
        throw new HttpException(
          'Saved analysis result is unavailable',
          HttpStatus.NOT_FOUND,
        );
      return link;
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (error instanceof SharedAnalysisLimitError)
        throw new HttpException(
          'Public share capacity is full',
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      throw new HttpException(
        'Could not create a public share link',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Public()
  @Get('api/share/:id')
  async open(@Param('id') id: string) {
    const key = normalizeShareId(id);
    if (!key)
      throw new HttpException(
        'Shared analysis is unavailable',
        HttpStatus.NOT_FOUND,
      );
    let result;
    try {
      result = await this.shares.getResult(key);
    } catch {
      throw new HttpException(
        'Shared analysis is temporarily unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!result)
      throw new HttpException(
        'Shared analysis is unavailable',
        HttpStatus.NOT_FOUND,
      );
    return result;
  }

  @Delete('api/analyze/recent/:hash/share')
  async revoke(@Param('hash') hash: string) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    try {
      return { revoked: await this.history.revokeShare(key) };
    } catch {
      throw new HttpException(
        'Could not revoke the public share link',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
