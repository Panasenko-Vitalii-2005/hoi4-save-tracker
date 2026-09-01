import type { AnalyzeResult } from "@/types";

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isAnalyzeResult(value: unknown): value is AnalyzeResult {
  if (!isObject(value) || typeof value.game_date !== "string") return false;
  if (
    !isObject(value.totals) ||
    !isObject(value.equipment_by_country) ||
    !isObject(value.world_equipment)
  )
    return false;
  return [
    "by_country",
    "stockpileSummaries",
    "militaryProductionSummaries",
    "divisionSummaries",
    "divisionTemplateCatalog",
    "divisionEquipmentCatalog",
    "armyHierarchySummaries",
    "navalLosses",
    "navalLossSummaries",
    "navalKills",
    "navalKillSummaries",
    "navalKillerShipSummaries",
  ].every((key) => Array.isArray(value[key]));
}
