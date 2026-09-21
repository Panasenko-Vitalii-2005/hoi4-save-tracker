import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AnalyzerTab } from "../src/components/analyzer/AnalyzerTab";
import App from "../src/App";
import { seedCsrfCookie } from "./auth-fixture";
import { i18n } from "../src/i18n";

// Test the actual request UI; plotting and the unrelated telemetry request are not needed.
vi.mock("react-plotly.js", () => ({
  default: ({ data, layout }: { data: unknown[]; layout: unknown }) => (
    <div
      data-testid="overview-plot"
      data-traces={JSON.stringify(data)}
      data-layout={JSON.stringify(layout)}
    />
  ),
}));
vi.mock("@/hooks/useRecords", () => ({
  useRecords: () => ({
    records: [],
    loading: false,
    error: null,
    reload: () => {},
  }),
}));

function snapshot(gameDate = "1944.5.1") {
  return {
    game_date: gameDate,
    parse_seconds: 0.01,
    file_size_mb: 1,
    active_countries: 0,
    totals: {
      divisions: 0,
      ships: 0,
      aircraft: 0,
      manpowerInField: 0,
      effectiveMilitaryFactories: 0,
      effectiveCivilianFactories: 0,
      effectiveDockyards: 0,
    },
    by_country: [],
    equipment_by_country: {},
    world_equipment: {},
    stockpileSummaries: [],
    militaryProductionSummaries: [],
    divisionSummaries: [],
    divisionTemplateCatalog: [],
    divisionEquipmentCatalog: [],
    armyHierarchySummaries: [],
    navalLosses: [],
    navalLossSummaries: [],
    navalKills: [],
    navalKillSummaries: [],
    navalKillerShipSummaries: [],
  };
}

describe("analysis request lifecycle", () => {
  let container: HTMLDivElement;
  let root: Root;
  let requests: Array<{
    init?: RequestInit;
    resolve: (response: Response) => void;
    reject: (reason: Error) => void;
  }>;
  let telemetryRequests: RequestInit[];
  let telemetryStatus: number;

  beforeEach(async () => {
    await i18n.changeLanguage("en");
    seedCsrfCookie();
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    requests = [];
    telemetryRequests = [];
    telemetryStatus = 202;
    sessionStorage.clear();
    sessionStorage.setItem(
      "hoi4:product-telemetry:session:v1",
      "22222222-2222-4222-8222-222222222222",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        if (url === "/api/auth/me")
          return Promise.resolve(Response.json({ user: { id: "test-user", email: "test@example.com", createdAt: "2026-01-01T00:00:00Z" } }));
        if (url === "/api/analyze/recent")
          return Promise.resolve(Response.json({ items: [] }));
        if (url === "/api/analyze/trends")
          return Promise.resolve(
            Response.json({ snapshotCount: 0, campaigns: [] }),
          );
        if (url === "/api/saves")
          return Promise.resolve(
            Response.json({
              dir: "/saves",
              exists: true,
              files: ["first.hoi4", "second.hoi4"].map((name) => ({
                name,
                path: `/saves/${name}`,
                size_mb: 1,
                modified: "2026-01-01T00:00:00Z",
              })),
            }),
          );
        if (url === "/api/product-events/client") {
          telemetryRequests.push(init ?? {});
          return Promise.resolve(
            new Response(null, { status: telemetryStatus }),
          );
        }
        expect(url).toBe("/api/analyze");
        return new Promise<Response>((resolve, reject) =>
          requests.push({ init, resolve, reject }),
        );
      }),
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    await i18n.changeLanguage("en");
  });

  const render = async (app = false) => {
    await act(async () => root.render(app ? <App /> : <AnalyzerTab />));
  };
  const row = (name = "first.hoi4") =>
    container.querySelector<HTMLTableRowElement>(
      `[aria-label="Analyze ${name}"]`,
    )!;
  const picker = () =>
    container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const button = (name: string) =>
    [...container.querySelectorAll("button")].find(
      (element) => element.textContent === name,
    )!;
  const status = () => container.querySelector('[role="status"]')!;
  const date = () =>
    container.querySelector(".analyzer-view-date strong")?.textContent;
  const start = async () => {
    await act(async () => row().click());
  };
  const respond = async (index: number, body: unknown, code = 201) => {
    await act(async () =>
      requests[index].resolve(Response.json(body, { status: code })),
    );
  };
  const chooseFile = async (
    file = new File(["HOI4txt"], "upload.hoi4"),
  ) => {
    const requestCount = requests.length;
    Object.defineProperty(picker(), "files", {
      configurable: true,
      value: [file],
    });
    picker().dispatchEvent(new Event("change", { bubbles: true }));
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (
        requests.length > requestCount ||
        !status().textContent?.includes("Uploading and analyzing")
      )
        break;
    }
  };

  test("starts idle with enabled controls and a persistent polite status region", async () => {
    await render();
    expect(status().textContent).toBe("");
    expect(status().getAttribute("aria-live")).toBe("polite");
    expect(button("Analyze Save").disabled).toBe(false);
    expect(picker().disabled).toBe(false);
    expect(row().tabIndex).toBe(0);
    expect(requests).toHaveLength(0);
  });

  test("normal SaaS navigation omits the legacy soldiers tracker", async () => {
    await render(true);
    expect(
      [...container.querySelectorAll(".page-shell > .tab-bar .tab-btn")].map(
        (item) => item.textContent,
      ),
    ).toEqual(["Campaign Trends", "Save Analyzer"]);
    expect(container.textContent).not.toContain("Soldiers by Country");
  });

  test("localizes Strategic Overview charts, thematic leaders, and Equipment by Country in Russian", async () => {
    await render();
    await start();
    const result = snapshot() as ReturnType<typeof snapshot> & {
      by_country: Record<string, unknown>[];
      equipment_by_country: Record<string, Record<string, number>>;
      world_equipment: Record<string, number>;
    };
    result.by_country = [{
      tag: "GER", manpowerInField: 1000, divisions: 10, aircraft: 20, ships: 5,
      effectiveMilitaryFactories: 12, effectiveCivilianFactories: 8,
      effectiveDockyards: 3, warCasualties: [], calculatedWarCasualtiesTotal: 0,
    }];
    result.equipment_by_country = { GER: { infantry_equipment_1: 100 } };
    result.world_equipment = { infantry_equipment_1: 100 };
    await respond(0, result);
    await act(async () => i18n.changeLanguage("ru"));

    expect(container.textContent).toContain("Мобилизационный ресурс");
    expect(container.textContent).toContain("Топ-10 стран по оснащению");
    expect(container.textContent).toMatch(/Показать оснащение|Скрыть оснащение/);
    expect(container.textContent).toContain("1 из 1");
    const plotPayload = [...container.querySelectorAll('[data-testid="overview-plot"]')]
      .map((node) => `${node.getAttribute("data-traces")} ${node.getAttribute("data-layout")}`)
      .join(" ");
    expect(plotPayload).toContain("Самолёты");
    expect(plotPayload).toContain("Корабли");
    expect(plotPayload).toContain("Военные заводы");
    expect(plotPayload).toContain("Гражданские фабрики");
    expect(plotPayload).toContain("Верфи");

    const showEquipment = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "Показать оснащение",
    );
    if (showEquipment) await act(async () => showEquipment.click());
    expect(container.textContent).toContain("Оснащение по странам");
    const localizedEquipmentPlots = [...container.querySelectorAll('[data-testid="overview-plot"]')]
      .map((node) => `${node.getAttribute("data-traces")} ${node.getAttribute("data-layout")}`)
      .join(" ");
    expect(localizedEquipmentPlots).toContain("Germany — состав оснащения страны");
    expect(container.querySelector('input[placeholder="Фильтр по стране…"]')).not.toBeNull();
  });

  test("local-save discovery failure is safe, keeps upload available, and retries explicitly", async () => {
    let savesAttempts = 0;
    vi.mocked(fetch).mockImplementation((url: string) => {
      if (url === "/api/analyze/recent")
        return Promise.resolve(Response.json({ items: [] }));
      if (url === "/api/saves") {
        if (savesAttempts++ === 0)
          return Promise.reject(new Error("C:/private/backend stack"));
        return Promise.resolve(
          Response.json({
            dir: "/saves",
            exists: true,
            files: [
              {
                name: "recovered.hoi4",
                path: "/saves/recovered.hoi4",
                size_mb: 1,
                modified: "2026-01-01T00:00:00Z",
              },
            ],
          }),
        );
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await render();
    expect(container.textContent).toContain("Cannot reach the analyzer service");
    expect(container.textContent).not.toMatch(/private|stack/);
    expect(button("Analyze Save").disabled).toBe(false);
    await act(async () => button("Try again").click());
    expect(container.textContent).toContain("recovered.hoi4");
  });

  test("shows indeterminate analysis, disables input/rows and submits the path", async () => {
    await render();
    await start();
    expect(status().textContent).toContain("Analyzing first.hoi4…");
    expect(status().textContent).not.toMatch(/\d+\s*[–%-]/);
    expect(
      status().querySelector(".spinner")?.getAttribute("aria-hidden"),
    ).toBe("true");
    expect(button("Analyze Save").disabled).toBe(true);
    expect(picker().disabled).toBe(true);
    expect(row().getAttribute("aria-disabled")).toBe("true");
    expect(row().tabIndex).toBe(-1);
    expect(requests[0].init?.body).toBe(
      JSON.stringify({ path: "/saves/first.hoi4" }),
    );
  });

  test("guards rapid clicks, Enter, Space and upload events before rerender", async () => {
    await render();
    await act(async () => {
      row().click();
      row().click();
      for (const key of ["Enter", " "])
        row().dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      await chooseFile();
    });
    expect(requests).toHaveLength(1);
    await act(async () => {
      row("second.hoi4").click();
      await chooseFile();
    });
    expect(requests).toHaveLength(1);
  });

  test.each(["Enter", " "])("keyboard %j starts one analysis", async (key) => {
    await render();
    await act(async () =>
      row().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
    );
    expect(requests).toHaveLength(1);
  });

  test("uploads multipart, prevents replacement and permits retry of the same file", async () => {
    await render();
    await act(async () => chooseFile());
    expect(status().textContent).toContain(
      "Uploading and analyzing upload.hoi4",
    );
    const form = requests[0].init?.body as FormData;
    expect((form.get("file") as File).name).toBe("upload.hoi4");
    await act(async () => chooseFile());
    expect(requests).toHaveLength(1);
    await respond(0, {}, 503);
    await act(async () => chooseFile());
    expect(requests).toHaveLength(2);
    await respond(1, snapshot());
    expect(date()).toBe("1944.5.1");
    expect(picker().disabled).toBe(false);
  });

  test("reports an unreadable selected file before sending multipart", async () => {
    await render();
    const file = new File(["HOI4txt"], "unavailable.hoi4");
    const read = vi
      .spyOn(FileReader.prototype, "readAsArrayBuffer")
      .mockImplementation(() => {
        throw new DOMException("private path");
      });

    await act(async () => chooseFile(file));
    read.mockRestore();

    expect(requests).toHaveLength(0);
    expect(status().textContent).toContain("selected save could not be read");
    expect(status().textContent).toContain("still available");
    expect(status().textContent).not.toContain("analyzer service");
    expect(status().textContent).not.toContain("private path");
    expect(button("Choose another file")).toBeDefined();
    expect(button("Analyze Save").disabled).toBe(false);
  });

  test("success clears loading, renders the result and reenables controls", async () => {
    await render();
    await start();
    await respond(0, snapshot());
    expect(date()).toBe("1944.5.1");
    expect(status().textContent).toContain("✓ first.hoi4");
    expect(status().querySelector(".spinner")).toBeNull();
    expect(button("Analyze Save").disabled).toBe(false);
    expect(row().getAttribute("aria-disabled")).toBe("false");
    expect(
      container.querySelectorAll(
        '[aria-label="Export current save analysis"] button',
      ),
    ).toHaveLength(2);
    const reportButton = [...container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === "View Report",
    )!;
    await act(async () => reportButton.click());
    expect(container.textContent).toContain("Save Analysis Report");
    expect(container.querySelector(".analysis-report")).not.toBeNull();
  });

  test("retains previous results while pending and replaces them only on success", async () => {
    await render();
    await start();
    await respond(0, snapshot());
    await start();
    expect(date()).toBe("1944.5.1");
    expect(status().textContent).toContain("Previous results remain visible");
    await respond(1, snapshot("1944.6.1"));
    expect(date()).toBe("1944.6.1");
    expect(container.textContent).toContain("vs previous save");
    expect(status().textContent).not.toContain(
      "Previous results remain visible",
    );
  });

  test("503 uses a dedicated message even for a non-JSON body and allows retry", async () => {
    await render();
    await start();
    await act(async () =>
      requests[0].resolve(
        new Response("Worker C:/private/save", { status: 503 }),
      ),
    );
    expect(status().textContent).toContain("busy with another save");
    expect(status().textContent).not.toMatch(/Worker|private/);
    expect(button("Analyze Save").disabled).toBe(false);
    await start();
    expect(status().textContent).not.toContain("busy");
    await respond(1, snapshot());
    expect(status().textContent).toContain("✓");
  });

  test.each(["server", "network", "non-json"])(
    "%s failure is safe, retains results and allows retry",
    async (kind) => {
      await render();
      await start();
      await respond(0, snapshot());
      await start();
      await act(async () => {
        const secret = "Worker crashed at C:/private/tmp/save.hoi4\nSTACK";
        if (kind === "network") requests[1].reject(new Error(secret));
        else if (kind === "non-json") requests[1].resolve(new Response(secret));
        else
          requests[1].resolve(
            Response.json({ message: secret }, { status: 500 }),
          );
      });
      expect(status().textContent).toContain(
        kind === "network"
          ? "Cannot reach the analyzer service"
          : kind === "non-json"
            ? "analysis response could not be read"
            : "Could not analyze the save.",
      );
      expect(status().textContent).not.toMatch(/Worker|private|STACK/);
      expect(date()).toBe("1944.5.1");
      expect(button("Analyze Save").disabled).toBe(false);
      if (kind === "network")
        await act(async () => button("Retry analysis").click());
      else await start();
      await respond(2, snapshot("1944.6.1"));
      expect(date()).toBe("1944.6.1");
      expect(status().textContent).not.toContain("Could not");
    },
  );

  test.each([
    [404, "no longer available"],
    [413, "too large"],
  ])("HTTP %i has safe specific wording", async (code, text) => {
    await render();
    await start();
    await respond(0, { message: "private path" }, code as number);
    expect(status().textContent).toContain(text);
    expect(status().textContent).not.toContain("private path");
  });

  test.each([
    ["FILE_TOO_LARGE", 413, "Maximum upload size: 256 MiB"],
    ["EMPTY_FILE", 400, "empty"],
    ["UNSUPPORTED_FILE_TYPE", 415, ".hoi4 save file"],
    ["INVALID_SAVE", 400, "not a valid Hearts of Iron IV"],
    ["CORRUPT_ARCHIVE", 400, "corrupted or incomplete"],
    ["UNSUPPORTED_SAVE", 422, "unsupported game version or mod configuration"],
    ["DECOMPRESSED_SIZE_LIMIT", 413, "uncompressed save is too large"],
    ["UPLOAD_TIMEOUT", 408, "upload took too long"],
    ["ANALYSIS_TIMEOUT", 504, "Analysis took too long and was stopped"],
    ["ANALYZER_BUSY", 503, "busy with another save"],
    ["PERSISTENCE_FAILED", 503, "could not be saved"],
    ["ANALYSIS_FAILED", 500, "Could not analyze the save"],
    ["UNKNOWN_SERVER_BUG", 500, "Could not analyze the save"],
  ])(
    "safe %s failure retains previous result, announces status and allows explicit retry",
    async (code, httpStatus, message) => {
      await render();
      await start();
      await respond(0, snapshot());
      await act(async () => chooseFile());
      await respond(
        1,
        {
          code,
          message: "STACK C:/private/server/upload.hoi4",
          maxUploadBytes: 268435456,
        },
        httpStatus as number,
      );
      expect(status().textContent).toContain(message);
      expect(status().textContent).not.toMatch(/STACK|private|server\/upload/);
      expect(status().getAttribute("aria-live")).toBe("polite");
      expect(date()).toBe("1944.5.1");
      expect(button("Analyze Save").disabled).toBe(false);
      const chooseAnother = new Set([
        "FILE_TOO_LARGE",
        "EMPTY_FILE",
        "UNSUPPORTED_FILE_TYPE",
        "INVALID_SAVE",
        "CORRUPT_ARCHIVE",
        "UNSUPPORTED_SAVE",
        "UNSUPPORTED_BINARY_SAVE",
        "DECOMPRESSED_SIZE_LIMIT",
      ]).has(String(code));
      expect(
        button(chooseAnother ? "Choose another file" : "Retry analysis"),
      ).toBeDefined();
      expect(requests).toHaveLength(2); // Never auto-retry.
      await act(async () => chooseFile());
      await respond(2, snapshot("1944.6.1"));
      expect(date()).toBe("1944.6.1");
    },
  );

  test("unsupported binary save renders guided recovery and reuses the upload picker", async () => {
    await render();
    await act(async () => chooseFile());
    await respond(
      0,
      {
        code: "UNSUPPORTED_BINARY_SAVE",
        message: "STACK C:/private/server/upload.hoi4",
      },
      422,
    );

    const recovery = container.querySelector(".binary-save-recovery")!;
    expect(recovery.textContent).toContain(
      "This save needs conversion before analysis",
    );
    expect(recovery.textContent).toContain(
      "recognized a valid Hearts of Iron IV binary save",
    );
    expect(recovery.textContent).toContain(
      "do not need to restart this campaign",
    );
    expect(recovery.textContent).toContain("save_as_binary=yes");
    expect(recovery.textContent).toContain("save_as_binary=no");
    expect(recovery.textContent).toContain(
      "Load the same existing campaign save",
    );
    expect(recovery.textContent).toContain(
      "Save the campaign again under a new name",
    );
    expect(recovery.textContent).toContain(
      "setting change does not convert the old file",
    );
    expect(recovery.textContent).toContain(
      "one-time compatibility setup",
    );
    expect(recovery.textContent).toContain("Documents → Paradox Interactive");
    expect(recovery.textContent).toContain("OneDrive");
    expect(recovery.textContent).not.toMatch(/STACK|private|server\/upload/);

    const clickPicker = vi.spyOn(picker(), "click");
    await act(async () => button("Choose converted save").click());
    expect(clickPicker).toHaveBeenCalledOnce();
  });

  test("invalid save retains the generic error without binary recovery instructions", async () => {
    await render();
    await act(async () => chooseFile());
    await respond(0, { code: "INVALID_SAVE" }, 400);

    expect(status().textContent).toContain(
      "not a valid Hearts of Iron IV save",
    );
    expect(container.querySelector(".binary-save-recovery")).toBeNull();
    expect(status().textContent).not.toContain("save_as_binary");
    expect(button("Choose another file")).toBeDefined();
  });

  test("untrusted limit values never become UI text", async () => {
    await render();
    await start();
    await respond(
      0,
      { code: "FILE_TOO_LARGE", maxUploadBytes: "C:/secret" },
      413,
    );
    expect(status().textContent).toContain("too large");
    expect(status().textContent).not.toContain("secret");
  });

  test("switching app tabs cannot reset an in-flight analysis or its guard", async () => {
    await render(true);
    await act(async () => button("Save Analyzer").click());
    await start();
    await act(async () => button("Campaign Trends").click());
    expect(
      container.querySelector(".analyzer-shell")?.parentElement?.hidden,
    ).toBe(true);
    await act(async () => button("Save Analyzer").click());
    await act(async () => row().click());
    expect(requests).toHaveLength(1);
    expect(button("Analyze Save").disabled).toBe(true);
    await respond(0, snapshot());
    expect(date()).toBe("1944.5.1");
  });

  test("records one meaningful open and deduplicated section views without affecting UI", async () => {
    await render();
    await start();
    await act(async () =>
      requests[0].resolve(
        Response.json(snapshot(), {
          status: 201,
          headers: { "X-Analysis-Hash": "a".repeat(64) },
        }),
      ),
    );
    await act(async () => Promise.resolve());

    expect(date()).toBe("1944.5.1");
    expect(
      telemetryRequests.map((entry) =>
        JSON.parse(String(entry.body)).eventName,
      ),
    ).toEqual(["analysis_opened", "analysis_section_viewed"]);
    expect(JSON.parse(String(telemetryRequests[1].body)).section).toBe(
      "overview",
    );

    await render();
    await act(async () => button("Production").click());
    await act(async () => button("Overview").click());
    await act(async () => Promise.resolve());
    expect(
      telemetryRequests.map((entry) => JSON.parse(String(entry.body))),
    ).toEqual([
      expect.objectContaining({ eventName: "analysis_opened" }),
      expect.objectContaining({
        eventName: "analysis_section_viewed",
        section: "overview",
      }),
      expect.objectContaining({
        eventName: "analysis_section_viewed",
        section: "production",
      }),
    ]);

    telemetryStatus = 503;
    await act(async () => button("Stockpile").click());
    await act(async () => Promise.resolve());
    expect(date()).toBe("1944.5.1");
    expect(container.textContent).not.toContain("telemetry");
  });
});
