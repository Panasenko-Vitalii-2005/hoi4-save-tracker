import { Injectable } from '@nestjs/common';
import type { QueryResultRow } from 'pg';
import {
  DatabaseService,
  type DatabaseExecutor,
} from '../database/database.service';
import type {
  AnalysisMetadataInput,
  ClientProductEventProperties,
  ProductEventName,
  ProductEventProperties,
} from './product-events.types';

interface AnalysisIdRow extends QueryResultRow {
  id: string;
}

interface InsertedEventRow extends QueryResultRow {
  id: string;
}

export interface ProductEventInsert {
  eventName: ProductEventName;
  userId: string | null;
  analysisId: string | null;
  flowId: string | null;
  sessionId?: string | null;
  properties: ProductEventProperties;
}

export interface ClientProductEventInsert {
  eventName:
    | 'analysis_opened'
    | 'analysis_section_viewed'
    | 'analysis_shared'
    | 'shared_analysis_opened';
  userId: string | null;
  contentHash: string;
  clientSessionId: string;
  properties: ClientProductEventProperties;
}

@Injectable()
export class ProductEventsRepository {
  constructor(private readonly database: DatabaseService) {}

  async insert(
    event: ProductEventInsert,
    executor: DatabaseExecutor = this.database,
  ): Promise<void> {
    await executor.query(
      `INSERT INTO product_events
         (event_name, user_id, analysis_id, flow_id, session_id, properties)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        event.eventName,
        event.userId,
        event.analysisId,
        event.flowId,
        event.sessionId ?? null,
        JSON.stringify(event.properties),
      ],
    );
  }

  async insertCompletion(
    event: Omit<ProductEventInsert, 'analysisId'>,
    metadata: AnalysisMetadataInput,
  ): Promise<string> {
    return this.database.transaction(async (executor) => {
      const analysis = await executor.query<AnalysisIdRow>(
        `INSERT INTO analyses
           (content_hash, file_size_bytes, parse_duration_ms,
            division_count, save_format)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (content_hash) DO UPDATE SET
           content_hash = EXCLUDED.content_hash
         RETURNING id`,
        [
          metadata.contentHash,
          metadata.fileSizeBytes,
          metadata.parseDurationMs,
          metadata.divisionCount,
          metadata.saveFormat,
        ],
      );
      const analysisId = analysis.rows[0]?.id;
      if (!analysisId) throw new Error('Analysis metadata was not persisted');
      await this.insert({ ...event, analysisId }, executor);
      return analysisId;
    });
  }

  async insertClient(event: ClientProductEventInsert): Promise<boolean> {
    const inserted = await this.database.query<InsertedEventRow>(
      `INSERT INTO product_events
         (event_name, user_id, analysis_id, flow_id, session_id,
          client_session_id, properties)
       SELECT $1, $2, analyses.id, NULL, NULL, $4, $5::jsonb
       FROM analyses
       WHERE analyses.content_hash = $3
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        event.eventName,
        event.userId,
        event.contentHash,
        event.clientSessionId,
        JSON.stringify(event.properties),
      ],
    );
    return inserted.rows.length > 0;
  }
}
