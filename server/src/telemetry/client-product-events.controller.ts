import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Optional,
} from '@nestjs/common';
import { AnalysisOwnershipService } from '../analyze/analysis-ownership.service';
import { normalizeAnalysisHash } from '../analyze/analysis-hash';
import { CurrentUser } from '../auth/current-user.decorator';
import type { SafeUserDto } from '../auth/auth.types';
import {
  ANALYSIS_SECTIONS,
  CLIENT_PRODUCT_EVENT_NAMES,
  type AnalysisSection,
  type ClientProductEventName,
  CAMPAIGN_REVIEW_KINDS,
  type CampaignReviewKind,
} from './product-events.types';
import { ProductEventsService } from './product-events.service';
import { CampaignReviewService } from './campaign-review.service';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_EVENTS = new Set<string>(CLIENT_PRODUCT_EVENT_NAMES);
const SECTIONS = new Set<string>(ANALYSIS_SECTIONS);

interface ClientProductEventBody {
  eventName: ClientProductEventName;
  analysisHash: string;
  clientSessionId: string;
  section?: AnalysisSection;
}

function parseBody(value: unknown): ClientProductEventBody | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const eventName = body.eventName;
  const analysisHash = body.analysisHash;
  const clientSessionId = body.clientSessionId;
  if (
    typeof eventName !== 'string' ||
    !CLIENT_EVENTS.has(eventName) ||
    typeof analysisHash !== 'string' ||
    !normalizeAnalysisHash(analysisHash) ||
    typeof clientSessionId !== 'string' ||
    !UUID.test(clientSessionId)
  )
    return null;

  const expectedKeys =
    eventName === 'analysis_section_viewed'
      ? ['analysisHash', 'clientSessionId', 'eventName', 'section']
      : ['analysisHash', 'clientSessionId', 'eventName'];
  if (
    Object.keys(body).length !== expectedKeys.length ||
    Object.keys(body).some((key) => !expectedKeys.includes(key))
  )
    return null;

  if (eventName === 'analysis_section_viewed') {
    if (typeof body.section !== 'string' || !SECTIONS.has(body.section))
      return null;
    return {
      eventName,
      analysisHash,
      clientSessionId,
      section: body.section as AnalysisSection,
    };
  }
  return {
    eventName: eventName as Exclude<
      ClientProductEventName,
      'analysis_section_viewed'
    >,
    analysisHash,
    clientSessionId,
  };
}

@Controller('api/product-events')
export class ClientProductEventsController {
  constructor(
    private readonly ownership: AnalysisOwnershipService,
    private readonly events: ProductEventsService,
    @Optional() private readonly reviews?: CampaignReviewService,
  ) {}

  @Post('campaign-review')
  @HttpCode(HttpStatus.ACCEPTED)
  async review(
    @CurrentUser() currentUser: SafeUserDto,
    @Body() value: unknown,
  ) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new HttpException('Invalid product event', HttpStatus.BAD_REQUEST);
    const body = value as Record<string, unknown>;
    if (
      Object.keys(body).length !== 5 ||
      Object.keys(body).some(
        (key) =>
          ![
            'eventName',
            'baseHash',
            'targetHash',
            'clientSessionId',
            'viewKind',
          ].includes(key),
      ) ||
      body.eventName !== 'campaign_review_opened' ||
      typeof body.baseHash !== 'string' ||
      typeof body.targetHash !== 'string' ||
      !normalizeAnalysisHash(body.baseHash) ||
      !normalizeAnalysisHash(body.targetHash) ||
      typeof body.clientSessionId !== 'string' ||
      !UUID.test(body.clientSessionId) ||
      !CAMPAIGN_REVIEW_KINDS.includes(body.viewKind as CampaignReviewKind)
    )
      throw new HttpException('Invalid product event', HttpStatus.BAD_REQUEST);
    const base = normalizeAnalysisHash(body.baseHash)!,
      target = normalizeAnalysisHash(body.targetHash)!;
    if (
      !this.reviews ||
      !(await this.reviews.eligible(currentUser.id, base, target))
    )
      throw new HttpException(
        'Campaign snapshots are unavailable',
        HttpStatus.NOT_FOUND,
      );
    await this.events.recordCampaignReview(
      currentUser.id,
      base,
      target,
      body.clientSessionId,
      body.viewKind as CampaignReviewKind,
    );
    return { accepted: true };
  }

  @Post('client')
  @HttpCode(HttpStatus.ACCEPTED)
  async record(
    @CurrentUser() currentUser: SafeUserDto,
    @Body() value: unknown,
  ) {
    const body = parseBody(value);
    if (!body)
      throw new HttpException('Invalid product event', HttpStatus.BAD_REQUEST);
    const hash = normalizeAnalysisHash(body.analysisHash)!;
    if (!(await this.ownership.hasOwnership(currentUser.id, hash)))
      throw new HttpException(
        'Saved analysis result is unavailable',
        HttpStatus.NOT_FOUND,
      );

    switch (body.eventName) {
      case 'analysis_opened':
        await this.events.recordAnalysisOpened(
          currentUser.id,
          hash,
          body.clientSessionId,
        );
        break;
      case 'analysis_section_viewed':
        await this.events.recordAnalysisSectionViewed(
          currentUser.id,
          hash,
          body.clientSessionId,
          body.section!,
        );
        break;
      case 'analysis_shared':
        await this.events.recordAnalysisShared(
          currentUser.id,
          hash,
          body.clientSessionId,
        );
        break;
    }
    return { accepted: true };
  }
}
