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

@Module({
  imports: [
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
    HealthController,
    SavesController,
  ],
  providers: [
    SaveAnalysisService,
    Hoi4AnalysisWorkerService,
    AnalysisResultCacheService,
    RecentAnalysesService,
    PersistedAnalysisResultService,
    AnalysisComparisonService,
  ],
})
export class AppModule {}
