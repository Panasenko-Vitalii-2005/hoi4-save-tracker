/** Normal resources validated for this phase. Oil and Fuel are not included. */
export const ECONOMY_RESOURCES = [
  'aluminium',
  'rubber',
  'tungsten',
  'steel',
  'chromium',
  'coal',
] as const;
export type EconomyResource = (typeof ECONOMY_RESOURCES)[number];
export type EconomyResourceMap = Record<EconomyResource, number | null>;

export interface EconomyReference {
  id: number;
  type: number;
}

/** Saved nominal amounts, NOT currently supplied resources or shortage. */
export interface EconomyProductionDemand {
  military: number | null;
  naval: number | null;
  refit: number | null;
  energy: number | null;
  total: number | null;
}

export interface EconomyResourceSummary {
  resource: EconomyResource;
  extracted: number | null;
  imported: number | null;
  baseExport: number | null;
  /** Raw to_export allocation, distinct from saved exported summary. */
  exportAllocation: number | null;
  savedExported: number | null;
  transferOverlordSubject: number | null;
  projectDemand: number | null;
  productionDemand: EconomyProductionDemand;
  /** Named components of the validated three-map to_use ledger. */
  serializedAvailableBeforeDemand: number | null;
  serializedProjectDemand: number | null;
  serializedProductionDemand: number | null;
  serializedBalance: number | null;
}

export interface CountryEconomySummary {
  countryTag: string;
  resources: EconomyResourceSummary[];
  warnings: string[];
}

export interface EconomyConvoySubscriber {
  convoys: number | null;
  total: number | null;
}

export interface EconomyDeliveryRoute {
  typeRaw: number | null;
  routeType: 'land' | 'sea' | null;
  senderTag: string | null;
  receiverTag: string | null;
  fromState: number | null;
  toState: number | null;
  convoysOwnerTag: string | null;
  landPath: number[] | null;
  navalPath: number[] | null;
}

export interface CommercialResourceTrade {
  relationRef: EconomyReference | null;
  exporterTag: string;
  importerTag: string | null;
  resource: EconomyResource;
  deliveredRaw: number | null;
  efficiency: number | null;
  efficiencyDueToLostConvoys: number | null;
  requiredCic: number | null;
  lendedCic: number | null;
  requestRaw: number | null;
  route: EconomyDeliveryRoute | null;
  convoySubscriber: EconomyConvoySubscriber | null;
  warnings: string[];
}

export interface ResourceRightsOrigin {
  beneficiaryTag: string;
  giverTag: string | null;
  stateId: number | null;
  originRef: EconomyReference | null;
  resources: EconomyResourceMap;
  resourcesUnclamped: EconomyResourceMap;
  givenResourceRights: { resource: EconomyResource; beneficiaryTag: string }[];
  efficiency: number | null;
  efficiencyDueToLostConvoys: number | null;
  requestRaw: number | null;
  route: EconomyDeliveryRoute | null;
  convoySubscriber: EconomyConvoySubscriber | null;
  warnings: string[];
}

/** Serialized state at save time; no engine simulation or freshness claim. */
export interface EconomyAnalysis {
  stateBasis: 'serialized';
  countrySummaries: CountryEconomySummary[];
  commercialTrades: CommercialResourceTrade[];
  resourceRightsOrigins: ResourceRightsOrigin[];
}
