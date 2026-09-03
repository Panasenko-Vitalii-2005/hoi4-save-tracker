import { Module } from '@nestjs/common';
import { databaseConfig } from './database.config';
import {
  createDatabasePool,
  DATABASE_CONFIG,
  DATABASE_POOL_FACTORY,
  DatabaseService,
} from './database.service';

@Module({
  providers: [
    { provide: DATABASE_CONFIG, useFactory: databaseConfig },
    { provide: DATABASE_POOL_FACTORY, useValue: createDatabasePool },
    DatabaseService,
  ],
  exports: [DatabaseService],
})
export class DatabaseModule {}
