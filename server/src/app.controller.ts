import { Controller, Post, Body, BadRequestException } from '@nestjs/common';
import { SaveAnalysisService } from './hoi4/save-analysis.service';

@Controller('saves')
export class AppController {
  constructor(private readonly saveAnalysisService: SaveAnalysisService) {}

  @Post('analyze')
  async analyze(@Body('paths') paths: string[]) {
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new BadRequestException('Paths must be a non-empty array');
    }
    return await this.saveAnalysisService.analyzeSaves(paths);
  }
}
