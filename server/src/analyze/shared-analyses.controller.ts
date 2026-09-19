import {
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Headers,
} from '@nestjs/common';
import { normalizeAnalysisHash } from './persisted-analysis-result.service';
import { RecentAnalysesService } from './recent-analyses.service';
import {
  normalizeShareId,
  SharedAnalysesService,
  SharedAnalysisLimitError,
} from './shared-analyses.service';
import { Public } from '../auth/route-access.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SafeUserDto } from '../auth/auth.types';
import { AnalysisOwnershipService } from './analysis-ownership.service';
import { ProductEventsService } from '../telemetry/product-events.service';

const CLIENT_SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller()
export class SharedAnalysesController {
  constructor(
    private readonly shares: SharedAnalysesService,
    private readonly history: RecentAnalysesService,
    private readonly ownership: AnalysisOwnershipService,
    private readonly productEvents: ProductEventsService,
  ) {}

  @Post('api/analyze/recent/:hash/share')
  async create(
    @CurrentUser() currentUser: SafeUserDto,
    @Param('hash') hash: string,
  ) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    try {
      if (!(await this.ownership.hasOwnership(currentUser.id, key)))
        throw new HttpException(
          'Saved analysis result is unavailable',
          HttpStatus.NOT_FOUND,
        );
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
  async open(
    @Param('id') id: string,
    @Headers('x-product-session') clientSessionId?: string,
  ) {
    const key = normalizeShareId(id);
    if (!key)
      throw new HttpException(
        'Shared analysis is unavailable',
        HttpStatus.NOT_FOUND,
      );
    let shared;
    try {
      shared = await this.shares.getResultWithHash(key);
    } catch {
      throw new HttpException(
        'Shared analysis is temporarily unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!shared)
      throw new HttpException(
        'Shared analysis is unavailable',
        HttpStatus.NOT_FOUND,
      );
    if (clientSessionId && CLIENT_SESSION_ID.test(clientSessionId))
      await this.productEvents.recordSharedAnalysisOpened(
        shared.hash,
        clientSessionId,
      );
    return shared.result;
  }

  @Delete('api/analyze/recent/:hash/share')
  async revoke(
    @CurrentUser() currentUser: SafeUserDto,
    @Param('hash') hash: string,
  ) {
    const key = normalizeAnalysisHash(hash);
    if (!key)
      throw new HttpException('Invalid analysis hash', HttpStatus.BAD_REQUEST);
    try {
      if (!(await this.ownership.hasOwnership(currentUser.id, key)))
        throw new HttpException(
          'Saved analysis result is unavailable',
          HttpStatus.NOT_FOUND,
        );
      return { revoked: await this.history.revokeShare(key) };
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Could not revoke the public share link',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
