import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { SafeUserDto } from '../../auth/auth.types';
import { CampaignIntelligenceService } from './campaign-intelligence.service';

@Controller('api/analyze/intelligence')
export class CampaignIntelligenceController {
  constructor(private readonly intelligence: CampaignIntelligenceService) {}

  @Get()
  async getIntelligence(
    @CurrentUser() user: SafeUserDto,
    @Query('campaignKey') campaignKey: string,
    @Query('countryTag') countryTag: string,
    @Query('baseHash') baseHash: string,
    @Query('targetHash') targetHash: string,
  ) {
    if (
      ![campaignKey, countryTag, baseHash, targetHash].every(
        (value) => typeof value === 'string',
      ) ||
      !/^campaign:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        campaignKey,
      ) ||
      !/^[A-Z][A-Z0-9]{2}$/.test(countryTag) ||
      !/^[a-f0-9]{64}$/.test(baseHash) ||
      !/^[a-f0-9]{64}$/.test(targetHash)
    )
      throw new BadRequestException('Invalid campaign intelligence query');
    try {
      return await this.intelligence.build(user.id, {
        campaignKey,
        countryTag,
        baseHash,
        targetHash,
      });
    } catch (error) {
      if (error instanceof NotFoundException)
        throw new NotFoundException('Campaign snapshots are unavailable');
      throw new HttpException(
        'Could not load campaign intelligence',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
