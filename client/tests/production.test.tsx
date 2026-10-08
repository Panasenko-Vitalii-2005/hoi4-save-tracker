import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CountryProductionDetails } from "../src/components/analyzer/CountryProductionDetails";
import { EquipmentProductionComparisonPanel } from "../src/components/analyzer/EquipmentProductionComparisonPanel";
import { i18n } from "../src/i18n";
import type {
  CountryMilitaryProductionSummary,
  MilitaryProductionDefinitionSummary,
  MilitaryProductionLineSummary,
} from "../src/types";

const definition = (
  equipmentDefinition: string,
  activeFactories: number,
): MilitaryProductionDefinitionSummary => ({
  equipmentDefinition,
  lineCount: 1,
  requestedFactories: activeFactories,
  activeFactories,
  queuedFactories: 0,
  damagedFactories: 0,
  currentItemsPerDay: 1,
  knownCurrentItemsPerDay: 1,
  outputComplete: true,
  resourceShortageLineCount: 0,
  lines: [],
});

const definitions = [
  definition("beta_equipment", 2),
  definition("zeta_equipment", 5),
  definition("alpha_equipment", 2),
];

const country: CountryMilitaryProductionSummary = {
  countryTag: "GER",
  lineCount: 3,
  definitionCount: 3,
  requestedFactories: 9,
  activeFactories: 9,
  queuedFactories: 0,
  damagedFactories: 0,
  resourceShortageLineCount: 0,
  definitions,
  unresolvedLines: [],
};

const reconciliationNote =
  "Effective military factories and production-line factory slots are separate save concepts and do not necessarily reconcile.";

// PaK 44 A/B controls: identical saved rate/demand/need, but manual UI shows
// 1/22 Tungsten and 7.74/day in A, 22/22 and 14.54/day in B. The legacy public
// payload never stored supplied quantity or realized output. Do not infer them.
const pak44Line: MilitaryProductionLineSummary = {
  countryTag: "GER",
  lineRef: { type: 56, id: 1738 },
  equipmentRef: { type: 70, id: 6847 },
  equipmentDefinition: "anti_tank_equipment_3",
  variantName: "12.8 cm PaK 44",
  version: null,
  creatorTag: "GER",
  originTag: null,
  obsolete: false,
  priority: 8,
  requestedFactories: 11,
  activeFactories: 11,
  queuedFactories: null,
  damagedFactories: null,
  effectiveActiveFactories: 11,
  effectiveQueuedFactories: 0,
  effectiveDamagedFactories: 0,
  currentItemsPerDay: 84.64039 / 5.82,
  progressFraction: 4.58278 / 5.82,
  activeEfficiencyAverage: null,
  activeEfficiencyMin: null,
  activeEfficiencyMax: null,
  hasResourceShortage: false,
  resourceShortages: [],
  industrialManufacturerRef: { type: 79, id: 24 },
  complete: true,
  warnings: [],
};

describe("Production country details", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    await i18n.changeLanguage("en");
    vi.unstubAllGlobals();
  });

  const render = async (
    effectiveMilitaryFactories: number | null,
    onSelectDefinition = vi.fn(),
  ) => {
    await act(async () =>
      root.render(
        <CountryProductionDetails
          country={country}
          selectedDefinition={definitions[0]}
          effectiveMilitaryFactories={effectiveMilitaryFactories}
          onSelectDefinition={onSelectDefinition}
        />,
      ),
    );
    return onSelectDefinition;
  };

  test("renders effective MIL and the non-reconciliation explanation once", async () => {
    await render(286);

    const summary = [
      ...container.querySelectorAll(".production-summary-grid > div"),
    ].find(
      (item) =>
        item.querySelector("dt")?.textContent === "Effective MIL factories",
    );
    expect(summary?.querySelector("dd")?.textContent).toBe("286");
    expect(container.textContent?.split(reconciliationNote)).toHaveLength(2);
  });

  test("renders unavailable effective MIL as a dash rather than zero", async () => {
    await render(null);

    const summary = [
      ...container.querySelectorAll(".production-summary-grid > div"),
    ].find(
      (item) =>
        item.querySelector("dt")?.textContent === "Effective MIL factories",
    );
    expect(summary?.querySelector("dd")?.textContent).toBe("—");
  });

  test("sorts definitions by active factories then definition and preserves selection identity", async () => {
    const onSelectDefinition = await render(286);
    const rows = [
      ...container.querySelectorAll<HTMLTableRowElement>(
        ".production-definition-table tbody tr",
      ),
    ];

    expect(
      rows.map((row) => row.querySelector(".production-code")?.textContent),
    ).toEqual(["zeta_equipment", "alpha_equipment", "beta_equipment"]);

    await act(async () => rows[1].click());
    expect(onSelectDefinition).toHaveBeenCalledWith("alpha_equipment");
    expect(country.definitions).toEqual(definitions);
  });

  async function renderLegacyLine(line = pak44Line) {
    // JSON roundtrip models existing persisted analyses: no new aliases needed.
    const savedDefinition = JSON.parse(
      JSON.stringify({
        ...definition("anti_tank_equipment_3", 11),
        currentItemsPerDay: line.currentItemsPerDay,
        knownCurrentItemsPerDay: line.currentItemsPerDay ?? 0,
        outputComplete: line.currentItemsPerDay !== null,
        resourceShortageLineCount: line.resourceShortages.length ? 1 : 0,
        lines: [line],
      }),
    ) as MilitaryProductionDefinitionSummary;
    await act(async () =>
      root.render(
        <CountryProductionDetails
          country={{
            ...country,
            definitions: [savedDefinition],
            resourceShortageLineCount:
              savedDefinition.resourceShortageLineCount,
          }}
          selectedDefinition={savedDefinition}
          effectiveMilitaryFactories={286}
          onSelectDefinition={vi.fn()}
        />,
      ),
    );
  }

  test.each([
    [
      "en",
      "Saved-derived rate",
      "No positive saved need entries",
      "not verified realized output",
      "does not establish sufficient supply",
    ],
    [
      "ru",
      "Темп по данным сохранения",
      "Нет положительных записей need",
      "не измеренный фактический выпуск",
      "не подтверждает достаточное снабжение",
    ],
  ])(
    "qualifies PaK 44 legacy rate and empty diagnostics in %s",
    async (language, label, empty, rateCaveat, needCaveat) => {
      await i18n.changeLanguage(language);
      await renderLegacyLine();
      expect(container.textContent).toContain(label);
      expect(container.textContent).toContain(empty);
      expect(container.textContent).toContain(rateCaveat);
      expect(container.textContent).toContain(needCaveat);
      expect(
        container.querySelector(".production-line-table")?.textContent,
      ).toContain("14.54");
      expect(container.textContent).not.toMatch(
        /Available:|Current rate|No shortages|Sufficient supply/,
      );
      expect(
        container
          .querySelector(".production-line-table [title]")
          ?.getAttribute("title"),
      ).toBeTruthy();
    },
  );

  test.each([
    ["en", "Saved nominal demand", "Saved need (raw)", "Steel"],
    ["ru", "Номинальная потребность из сохранения", "Исходный need", "Сталь"],
  ])(
    "shows saved demand and raw need, not available resources, in %s",
    async (language, demand, need, resource) => {
      await i18n.changeLanguage(language);
      await renderLegacyLine({
        ...pak44Line,
        hasResourceShortage: true,
        resourceShortages: [
          { resource: "steel", amount: 33, need: 1 },
          { resource: "tungsten", amount: null, need: 2 },
        ],
      });
      const entries = container.querySelectorAll(".production-shortage-item");
      expect(entries[0].textContent).toContain(resource);
      expect(entries[0].textContent).toContain(`${demand}: 33`);
      expect(entries[0].textContent).toContain(`${need}: 1`);
      expect(entries[1].textContent).toContain(`${demand}: —`);
      expect(container.textContent).not.toMatch(
        /Available:|Доступно:|Supplied:/,
      );
    },
  );

  test("unknown saved-derived rate remains unavailable, never a zero rate", async () => {
    await renderLegacyLine({ ...pak44Line, currentItemsPerDay: null });
    const rateCell = container.querySelector(".production-line-table tbody tr")
      ?.children[2];
    expect(rateCell?.textContent).toBe("—");
    expect(
      container.querySelector(".production-definition-table")?.textContent,
    ).toContain("Unavailable");
    expect(container.textContent).not.toContain("0 / day");
  });

  test.each([
    [
      "en",
      "Saved-derived production rate / day",
      "Changes compare saved-derived rates",
    ],
    [
      "ru",
      "Темп по данным сохранения в день",
      "Изменения сравнивают расчётные темпы",
    ],
  ])(
    "Compare preserves exact rate identity and qualified per-day semantics in %s",
    async (language, heading, caveat) => {
      await i18n.changeLanguage(language);
      const rate = 84.64039 / 5.82;
      const comparison = {
        countryTag: "GER",
        hasChanges: false,
        definitions: [
          {
            equipmentDefinition: "anti_tank_equipment_3",
            hasChanges: false,
            stockpile: null,
            production: {
              presence: "both" as const,
              activeFactories: { before: 11, after: 11, delta: 0 },
              currentItemsPerDay: {
                before: rate,
                after: rate,
                delta: 0,
                baseComplete: true,
                targetComplete: true,
                baseKnown: rate,
                targetKnown: rate,
              },
            },
          },
        ],
      };
      await act(async () =>
        root.render(
          <EquipmentProductionComparisonPanel
            countryTag="GER"
            comparison={comparison}
          />,
        ),
      );
      expect(container.textContent).toContain(heading);
      expect(container.textContent).toContain(caveat);
      expect(container.textContent).toContain("anti_tank_equipment_3");
      expect(container.textContent).not.toContain("7.74");
      expect(
        comparison.definitions[0].production.currentItemsPerDay.before,
      ).toBe(rate);
    },
  );
});
