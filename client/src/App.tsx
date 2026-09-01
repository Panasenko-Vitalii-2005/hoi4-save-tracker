import { useEffect, useState } from "react";
import { AnalyzerTab } from "@/components/analyzer/AnalyzerTab";
import { SharedAnalysisPage } from "@/components/analyzer/SharedAnalysisPage";
import { CampaignTrends } from "@/components/chart/CampaignTrends";
import { SoldiersTab } from "@/components/soldiers/SoldiersTab";
import { TabBar } from "@/components/ui/TabBar";
import { useRecords } from "@/hooks/useRecords";
import type { TabId } from "@/types";

type Theme = "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("hoi4-theme") as Theme | null) ?? "light",
  );
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("hoi4-theme", theme);
  }, [theme]);
  const toggle = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  return [theme, toggle];
}

function Dashboard() {
  const [tab, setTab] = useState<TabId>("chart");
  const [analyzerOpened, setAnalyzerOpened] = useState(false);
  const [analyzerFocus, setAnalyzerFocus] = useState<{
    target: "analyze" | "import";
    request: number;
  } | null>(null);
  const { records, loading, error, reload } = useRecords();
  const openAnalyzer = (target: "analyze" | "import") => {
    setAnalyzerOpened(true);
    setAnalyzerFocus((current) => ({
      target,
      request: (current?.request ?? 0) + 1,
    }));
    setTab("analyzer");
  };

  return (
    <div className="page-shell">
      <TabBar
        active={tab}
        onChange={(nextTab) => {
          if (nextTab === "analyzer") setAnalyzerOpened(true);
          setTab(nextTab);
        }}
      />

      {tab === "chart" && (
        <CampaignTrends
          telemetry={records}
          telemetryLoading={loading}
          telemetryError={error}
          reloadTelemetry={reload}
          onAnalyzeSave={() => openAnalyzer("analyze")}
          onImportCampaign={() => openAnalyzer("import")}
        />
      )}
      {tab === "soldiers" && <SoldiersTab />}
      {analyzerOpened && (
        <div hidden={tab !== "analyzer"}>
          <AnalyzerTab
            focusRequest={analyzerFocus}
            onNavigateToCampaignTrends={() => setTab("chart")}
          />
        </div>
      )}
    </div>
  );
}

function sharedId(pathname: string): string | null {
  const match = pathname.match(/^\/share\/([^/]+)\/?$/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return "";
    }
  }
  return pathname === "/share" || pathname.startsWith("/share/") ? "" : null;
}

export default function App() {
  const [theme, toggleTheme] = useTheme();
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);
  const publicId = sharedId(pathname);

  return (
    <>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={
          theme === "light" ? "Switch to dark theme" : "Switch to light theme"
        }
        aria-label="Toggle theme"
      >
        {theme === "light" ? "🌙" : "☀️"}
      </button>
      {publicId !== null ? (
        <SharedAnalysisPage publicId={publicId} />
      ) : (
        <Dashboard />
      )}
    </>
  );
}
