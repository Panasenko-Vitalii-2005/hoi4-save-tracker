import type { SaveErrorCode } from '../hoi4/save-input.error';
import type { SaveContainerFormat } from '../hoi4/save-container';

export const PRODUCT_EVENT_NAMES = [
  'analysis_upload_started',
  'analysis_upload_rejected',
  'analysis_completed',
  'analysis_failed',
  'analysis_opened',
  'analysis_section_viewed',
  'analysis_shared',
  'shared_analysis_opened',
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

export const CLIENT_PRODUCT_EVENT_NAMES = [
  'analysis_opened',
  'analysis_section_viewed',
  'analysis_shared',
] as const;
export type ClientProductEventName =
  (typeof CLIENT_PRODUCT_EVENT_NAMES)[number];

export const ANALYSIS_SECTIONS = [
  'overview',
  'war-casualties',
  'naval-losses',
  'stockpile',
  'production',
  'land-forces',
] as const;
export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];

export const ANALYSIS_SAVE_FORMATS = ['plain_text', 'zip_text'] as const;
export type AnalysisSaveFormat = SaveContainerFormat;

export const ANALYSIS_FAILURE_STAGES = [
  'admission',
  'upload',
  'validation',
  'analysis',
  'persistence',
] as const;
export type AnalysisFailureStage = (typeof ANALYSIS_FAILURE_STAGES)[number];

export type ProductAnalysisErrorCode = SaveErrorCode | 'SAVE_NOT_FOUND';

export interface AnalysisMetadataInput {
  contentHash: string;
  fileSizeBytes: number;
  parseDurationMs: number;
  divisionCount: number;
  saveFormat: AnalysisSaveFormat;
}

export interface AnalysisAttemptContext {
  flowId: string;
  userId: string | null;
  startedAtMs: number;
  stage: AnalysisFailureStage;
  fileSizeBytes?: number;
  saveFormat?: AnalysisSaveFormat;
  analysis?: AnalysisMetadataInput;
  terminalRecorded: boolean;
}

export interface AnalysisTelemetryCarrier {
  productAnalysisAttempt?: AnalysisAttemptContext;
}

export interface AnalysisStartedProperties {
  fileSizeBytes?: number;
  saveFormat?: AnalysisSaveFormat;
}

export interface AnalysisFailureProperties extends AnalysisStartedProperties {
  errorCode: ProductAnalysisErrorCode;
  failureStage: AnalysisFailureStage;
}

export interface AnalysisCompletedProperties {
  totalDurationMs: number;
}

export interface AnalysisSectionViewedProperties {
  section: AnalysisSection;
}

export type ClientProductEventProperties =
  Record<string, never> | AnalysisSectionViewedProperties;

export type ProductEventProperties =
  | AnalysisStartedProperties
  | AnalysisFailureProperties
  | AnalysisCompletedProperties
  | ClientProductEventProperties;
