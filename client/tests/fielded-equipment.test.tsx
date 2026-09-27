import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LandForcesTab } from "../src/components/analyzer/LandForcesTab";
import { i18n } from "../src/i18n";
import { deriveLegacyFieldedEquipment } from "../src/lib/legacyFieldedEquipment";
import type { CountryDivisionSummary, CountryFieldedEquipmentSummary } from "../src/types";

function country(countryTag: string): CountryDivisionSummary {
  return {
    countryTag,
    divisionCount: 1,
    resolvedTemplateCount: 0,
    unresolvedTemplateCount: 1,
    currentManpowerTotal: 100,
    requiredManpowerTotal: 100,
    missingManpowerTotal: 0,
    fullManpowerDivisionCount: 1,
    underManpowerDivisionCount: 0,
    divisions: [],
  };
}

const fielded: CountryFieldedEquipmentSummary[] = [
  { countryTag: "GER", definitions: [], unresolvedOccurrences: [] },
  {
    countryTag: "USA",
    definitions: [{
      definition: "anti_air_equipment_2",
      amount: 4.5,
      variants: [
        { equipmentRef: { type: 70, id: 1 }, definition: "anti_air_equipment_2", variantName: null, amount: 3.25, version: 1, creatorTag: "USA", originTag: "USA", obsolete: false },
        { equipmentRef: { type: 70, id: 2 }, definition: "anti_air_equipment_2", variantName: "Custom AA", amount: 1.25, version: null, creatorTag: "JAP", originTag: "JAP", obsolete: true },
        { equipmentRef: { type: 70, id: 3 }, definition: "anti_air_equipment_2", variantName: null, amount: 0, version: null, creatorTag: "HUN", originTag: "HUN", obsolete: false },
      ],
    }],
    unresolvedOccurrences: [],
  },
];

function Harness({ summaries = [country("GER"), country("USA")], data = fielded }: {
  summaries?: CountryDivisionSummary[];
  data?: CountryFieldedEquipmentSummary[];
}) {
  const [selectedTag, setSelectedTag] = useState<string | null>("USA");
  const [divisionKey, setDivisionKey] = useState<string | null>(null);
  return <LandForcesTab
    summaries={summaries}
    templates={[]}
    equipment={[]}
    fieldedEquipment={data}
    hierarchies={[]}
    selectedTag={selectedTag}
    selectedDivisionKey={divisionKey}
    onSelectedTagChange={setSelectedTag}
    onSelectedDivisionKeyChange={setDivisionKey}
  />;
}

describe("Land Forces fielded equipment", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await i18n.changeLanguage("en");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<Harness />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  test("shows a third inner tab, exact fielded totals and expandable variants", async () => {
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Army hierarchy", "Divisions", "Equipment"]);
    await act(async () => tabs[2].click());
    expect(container.textContent).toContain("Fielded");
    expect(container.textContent).toContain("4.5");
    expect(container.textContent).not.toContain("Required");
    expect(container.querySelector(".stockpile-variant-expansion")).toBeNull();
    const expand = container.querySelector<HTMLButtonElement>(".fielded-equipment-table .stockpile-expand-button")!;
    await act(async () => expand.click());
    expect(expand.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("40 mm Automatic Gun M1");
    expect(container.textContent).toContain("Custom AA");
    expect(container.textContent).toContain("Improved Anti-Air");
    expect(container.textContent).toContain("3.25");
    expect(container.textContent).toContain("1.25");
    await act(async () => expand.click());
    expect(container.querySelector(".stockpile-variant-expansion")).toBeNull();
  });

  test("country switch changes the fielded view and empty state; Russian labels render", async () => {
    await act(async () => i18n.changeLanguage("ru"));
    const equipmentTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Снаряжение")!;
    await act(async () => equipmentTab.click());
    expect(container.textContent).toContain("В войсках");
    const germany = [...container.querySelectorAll<HTMLTableRowElement>(".land-forces-country-table tbody tr")]
      .find((row) => row.textContent?.includes("GER"))!;
    await act(async () => germany.click());
    const nextEquipmentTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Снаряжение")!;
    await act(async () => nextEquipmentTab.click());
    expect(container.textContent).toContain("В дивизиях этой страны оснащение не зафиксировано.");
    expect(container.textContent).not.toContain("40 mm Automatic Gun M1");
  });

  test("missing country summary does not fabricate zero", async () => {
    await act(async () => root.render(<Harness data={[]} />));
    const equipmentTab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
      .find((tab) => tab.textContent === "Equipment")!;
    await act(async () => equipmentTab.click());
    expect(container.textContent).toContain("unavailable for this country");
  });

  test("older persisted payloads derive fielded equipment from exact division refs", () => {
    const legacy = [{
      ...country("USA"),
      divisions: [{ equipment: [{ equipmentRef: { type: 70, id: 1 }, amount: 2.5 }] }],
    }] as unknown as CountryDivisionSummary[];
    const result = deriveLegacyFieldedEquipment(legacy, [{
      equipmentRef: { type: 70, id: 1 },
      definition: "anti_air_equipment_2",
      name: null,
      version: 1,
      maxVersion: 1,
      parentEquipmentRef: null,
      creatorTag: "USA",
      originTag: "USA",
      obsolete: false,
      isFrame: false,
      designTeamRef: null,
    }]);
    expect(result[0].definitions[0].amount).toBe(2.5);
    expect(result[0].definitions[0].variants[0].equipmentRef).toEqual({ type: 70, id: 1 });
  });

  test("a save without land-force countries keeps the existing empty state", async () => {
    await act(async () => root.render(<Harness summaries={[]} data={[]} />));
    expect(container.textContent).toContain("No land-force divisions were found in this save.");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
  });
});
