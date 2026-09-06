import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
} from '@nestjs/common';
import { CampaignTrendsService } from './campaign-trends.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SafeUserDto } from '../auth/auth.types';
import { UserAnalysesService } from './user-analyses.service';

@Controller('api/analyze/trends')
export class CampaignTrendsController {
  constructor(
    private readonly trends: CampaignTrendsService,
    private readonly userAnalyses: UserAnalysesService,
  ) {}

  @Get()
  async getTrends(@CurrentUser() currentUser: SafeUserDto) {
    try {
      return await this.trends.build(
        await this.userAnalyses.list(currentUser.id),
      );
    } catch {
      throw new HttpException(
        'Could not load campaign trends',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  @Get('equipment')
  async getEquipmentTrends(
    @CurrentUser() currentUser: SafeUserDto,
    @Query('campaignKey') campaignKey: string,
    @Query('countryTag') countryTag: string,
  ) {
    if (
      !/^(campaign:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|unknown:[a-f0-9]{64})$/.test(
        campaignKey ?? '',
      ) ||
      !/^[A-Z0-9]{3}$/.test(countryTag ?? '')
    )
      throw new BadRequestException('Invalid campaign equipment query');
    try {
      return await this.trends.buildEquipment(
        campaignKey,
        countryTag,
        await this.userAnalyses.list(currentUser.id),
      );
    } catch {
      throw new HttpException(
        'Could not load campaign equipment trends',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
