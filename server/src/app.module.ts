import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import * as path from 'path';
import {
  RecordsController,
  SoldiersController,
  HealthController,
} from './records/records.controller';
import { AnalyzeController } from './analyze/analyze.controller';
import { SavesController } from './saves/saves.controller';
import { AppController } from './app.controller';
import { SaveAnalysisService } from './hoi4/save-analysis.service';
import { Hoi4AnalysisWorkerService } from './hoi4/hoi4-analysis-worker.service';
import { AnalysisResultCacheService } from './hoi4/analysis-result-cache.service';
import { RecentAnalysesService } from './analyze/recent-analyses.service';
import { PersistedAnalysisResultService } from './analyze/persisted-analysis-result.service';
import { AnalysisComparisonService } from './analyze/analysis-comparison.service';
import { SaveUploadInterceptor } from './analyze/save-upload.interceptor';
import { SharedAnalysesController } from './analyze/shared-analyses.controller';
import { SharedAnalysesService } from './analyze/shared-analyses.service';
import { CampaignTrendsController } from './analyze/campaign-trends.controller';
import { CampaignTrendsService } from './analyze/campaign-trends.service';
import { CampaignSnapshotProjectionCacheService } from './analyze/campaign-snapshot-projection-cache.service';
import { BatchAnalysisController } from './analyze/batch-analysis.controller';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    DatabaseModule,
    ServeStaticModule.forRoot({
      rootPath: path.join(__dirname, '..', '..', '..', 'client', 'dist'),
      exclude: ['/api/(.*)'],
    }),
  ],
  controllers: [
    AppController,
    RecordsController,
    SoldiersController,
    AnalyzeController,
    SharedAnalysesController,
    CampaignTrendsController,
    BatchAnalysisController,
    HealthController,
    SavesController,
  ],
  providers: [
    SaveAnalysisService,
    Hoi4AnalysisWorkerService,
    AnalysisResultCacheService,
    RecentAnalysesService,
    PersistedAnalysisResultService,
    SharedAnalysesService,
    AnalysisComparisonService,
    CampaignSnapshotProjectionCacheService,
    CampaignTrendsService,
    SaveUploadInterceptor,
  ],
})
export class AppModule {}
