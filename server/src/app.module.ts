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
  providers: [SaveAnalysisService],
})
export class AppModule {}
