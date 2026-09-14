import { describe, expect, test } from "vitest";
import {
  formatCountryDisplayName,
  getCountryDisplayName,
} from "@/lib/countryNames";
import {
  formatEquipmentDefinition,
  formatProductionRate,
} from "@/lib/utils";

describe("presentation formatters", () => {
  test.each([
    ["GSM", "Gansu Ma"],
    ["GDC", "Guangdong"],
    ["HBC", "Hebei-Chahar"],
    ["NXM", "Ningxia Ma"],
    ["RKH", "Protektorat Böhmen und Mähren"],
    ["RKB", "Reichskommissariat Belgien-Nordfrankreich"],
    ["GEN", "Generalgouvernement"],
    ["RKG", "Reichskommissariat Norwegen"],
    ["RKN", "Reichskommissariat Niederlande"],
    ["RNG", "China"],
    ["PSR", "Second Philippine Republic"],
    ["KHM", "Khotan Ma"],
    ["KUM", "Kumul Khanate"],
  ])("uses a verified country label for %s", (tag, name) => {
    expect(getCountryDisplayName(tag)).toBe(name);
    expect(formatCountryDisplayName(tag)).toBe(`${name} (${tag})`);
  });

  test.each(["GBC", "D01", "D03", "D04"])(
    "keeps %s as the safe raw fallback",
    (tag) => expect(getCountryDisplayName(tag)).toBe(tag),
  );

  test.each([
    ["train_equipment_1", "Civilian Train"],
    ["support_equipment_1", "Support Equipment"],
    ["anti_air_equipment_1", "Towed Anti-Aircraft"],
    ["artillery_equipment_1", "Towed Artillery"],
    ["heavy_tank_destroyer_chassis_2", "Improved Heavy Tank Destroyer"],
    ["infantry_equipment_1", "Infantry Equipment I"],
    ["infantry_equipment_2", "Infantry Equipment II"],
    ["small_plane_airframe_2", "Improved Small Airframe"],
    ["motorized_equipment_1", "Truck"],
    ["small_plane_airframe_0", "Inter-War Small Airframe"],
    ["artillery_equipment_2", "Improved Artillery"],
    ["motorized_equipment_0", "Early Truck"],
    ["train_equipment_3", "Armored Train"],
    ["transport_plane_equipment_1", "Inter-War Transport Plane"],
    ["anti_tank_equipment_3", "Advanced Anti-Tank"],
    ["medium_tank_chassis_2", "Improved Medium Tank"],
    ["cv_small_plane_airframe_2", "Improved Carrier Airframe"],
  ])("uses a verified equipment label for %s", (definition, name) => {
    expect(formatEquipmentDefinition(definition)).toBe(name);
  });

  test("keeps an unknown equipment definition readable without hiding its identity", () => {
    expect(formatEquipmentDefinition("my_mod_super_weapon")).toBe(
      "My mod super weapon",
    );
  });

  test.each([
    [0.5458425, "0.55"],
    [30.020773195876288, "30.02"],
    [2.537419734904271, "2.54"],
    [61595.3008, "61,595.30"],
  ])("limits production rate %s to two decimals", (value, expected) => {
    expect(formatProductionRate(value)).toBe(expected);
  });

  test("keeps an unavailable production rate distinct from zero", () => {
    expect(formatProductionRate(null)).toBe("—");
    expect(formatProductionRate(0)).toBe("0.00");
  });
});
