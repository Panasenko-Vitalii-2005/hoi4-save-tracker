import type {
  CountryNavalSummary,
  NavalLossEvent,
  NavalLossMethodology,
  NavalLossParentContext,
  NavalLossSummary,
  ParsedNavalLoss,
  ParsedNavalRemovalMarker,
} from './naval-loss.types';

export interface NavalLossAnalyzeResultDto {
  summary: NavalLossSummary;
  byCountry: CountryNavalSummary[];
  methodology: NavalLossMethodology;
  detailAvailability: {
    events: number;
    removalMarkers: number;
    rawRecords: number;
  };
}

export interface NavalLossPageDto<T> {
  items: T[];
  nextCursor: string | null;
  total: number;
}

export type NavalLossEventPageDto = NavalLossPageDto<NavalLossEvent>;

export type NavalRemovalMarkerPageDto =
  NavalLossPageDto<ParsedNavalRemovalMarker>;

export interface NavalLossEventDetailsDto {
  event: NavalLossEvent;
  sourceRecords: ParsedNavalLoss[];
  parentContexts: NavalLossParentContext[];
}
