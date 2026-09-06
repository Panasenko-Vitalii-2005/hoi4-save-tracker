import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import {
  normalizeAnalysisHash,
  PersistedAnalysisResultService,
} from './persisted-analysis-result.service';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SafeUserDto } from '../auth/auth.types';
import { AnalysisOwnershipService } from './analysis-ownership.service';

const MAX_PREFLIGHT_HASHES = 200;

interface BatchPreflightRequest {
  hashes?: unknown;
}

@Controller('api/analyze/batch')
export class BatchAnalysisController {
  constructor(
    private readonly results: PersistedAnalysisResultService,
    private readonly ownership: AnalysisOwnershipService,
  ) {}

  @Post('preflight')
  async preflight(
    @CurrentUser() currentUser: SafeUserDto,
    @Body() body: BatchPreflightRequest,
  ) {
    if (
      !Array.isArray(body?.hashes) ||
      body.hashes.length > MAX_PREFLIGHT_HASHES
    )
      throw new HttpException(
        `Provide at most ${MAX_PREFLIGHT_HASHES} save hashes`,
        HttpStatus.BAD_REQUEST,
      );

    const hashes: string[] = [];
    const seen = new Set<string>();
    for (const value of body.hashes) {
      const hash =
        typeof value === 'string' ? normalizeAnalysisHash(value) : null;
      if (!hash)
        throw new HttpException('Invalid save hash', HttpStatus.BAD_REQUEST);
      if (!seen.has(hash)) {
        hashes.push(hash);
        seen.add(hash);
      }
    }

    let owned: Set<string>;
    try {
      owned = await this.ownership.ownedHashes(currentUser.id, hashes);
    } catch {
      throw new HttpException(
        'Could not check saved analyses',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const available = await this.results.available(
      hashes.filter((hash) => owned.has(hash)),
    );
    return { knownHashes: hashes.filter((hash) => available.has(hash)) };
  }
}
