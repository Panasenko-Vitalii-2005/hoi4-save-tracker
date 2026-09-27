import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractCountryEquipmentNames,
  readSupportedDefinitions,
  renderCountryEquipmentNames,
} from "./generate-equipment-names.mjs";

test("reads supported definitions from the existing generic-name map", () => {
  const source = `const EQUIPMENT_DISPLAY_NAMES = Object.freeze({
    anti_air_equipment_2: "Improved Anti-Air",
    "infantry_equipment_1": "Infantry Equipment I",
  });`;
  assert.deepEqual(
    [...readSupportedDefinitions(source)],
    ["anti_air_equipment_2", "infantry_equipment_1"],
  );
});

test("filters unsupported keys and uses only the verified Logistics short exception", () => {
  const source = `l_english:
 USA_anti_air_equipment_2: "40 mm Automatic Gun M1"
 USA_anti_air_equipment_2_short: "40 mm"
 JAP_anti_air_equipment_2: "Type 2 20 mm AA Machine Cannon"
 JAP_anti_air_equipment_2_short: "Type 2 20 mm"
 USA_infantry_equipment_1:0 "M1 Garand"
 USA_infantry_equipment_1_short: "M1"
 USA_support_weapons: "Support Weapons"
 USA_EQUIPMENT_VERSION_1: "Version 1"
 USA_anti_air_equipment_2_desc: "Description"
 GER_armored_car_equipment_2: "Sonderkraftfahrzeug 234 "Puma""`;
  const allowed = new Set([
    "anti_air_equipment_2", "infantry_equipment_1", "armored_car_equipment_2",
  ]);
  const names = extractCountryEquipmentNames(source, allowed);
  assert.deepEqual([...names], [
    ["GER_armored_car_equipment_2", 'Sonderkraftfahrzeug 234 "Puma"'],
    ["JAP_anti_air_equipment_2", "Type 2 20 mm"],
    ["USA_anti_air_equipment_2", "40 mm Automatic Gun M1"],
    ["USA_infantry_equipment_1", "M1 Garand"],
  ]);
  const rendered = renderCountryEquipmentNames(names, "known-hash");
  assert.equal(rendered, renderCountryEquipmentNames(names, "known-hash"));
  assert.doesNotMatch(rendered, /support_weapons|EQUIPMENT_VERSION|_desc|_short/);
  assert.match(rendered, /Source SHA-256: known-hash/);
  assert.doesNotMatch(rendered, /Steam|\\Users\\/);
});

test("rejects ambiguous or incompatible input instead of silently changing names", () => {
  assert.throws(() => readSupportedDefinitions("const other = {};"), /allowlist/);
  assert.throws(() => extractCountryEquipmentNames(
    "l_russian:\n USA_infantry_equipment_1: \"M1 Garand\"",
    new Set(["infantry_equipment_1"]), new Set(),
  ), /English/);
  assert.throws(() => extractCountryEquipmentNames(
    "l_english:\n USA_infantry_equipment_1: \"M1 Garand\"\n USA_infantry_equipment_1: \"Duplicate\"",
    new Set(["infantry_equipment_1"]), new Set(),
  ), /Duplicate/);
});
