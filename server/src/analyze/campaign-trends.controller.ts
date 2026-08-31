import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { CampaignTrendsService } from './campaign-trends.service';

@Controller('api/analyze/trends')
export class CampaignTrendsController {
  constructor(private readonly trends: CampaignTrendsService) {}

  @Get()
  async getTrends() {
    try {
      return await this.trends.build();
    } catch {
      throw new HttpException(
        'Could not load campaign trends',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
