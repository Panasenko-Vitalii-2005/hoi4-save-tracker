import { useState, useEffect } from 'react'
import type { TabId } from '@/types'
import { useRecords } from '@/hooks/useRecords'
import { TabBar } from '@/components/ui/TabBar'
import { SummaryGrid } from '@/components/ui/SummaryGrid'
import { ChartTab } from '@/components/chart/ChartTab'
import { SoldiersTab } from '@/components/soldiers/SoldiersTab'
import { AnalyzerTab } from '@/components/analyzer/AnalyzerTab'
import { fmtNum } from '@/lib/utils'

type Theme = 'light' | 'dark'

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() =>
    (localStorage.getItem('hoi4-theme') as Theme | null) ?? 'light'
  )
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('hoi4-theme', theme)
  }, [theme])
  const toggle = () => setTheme(t => t === 'light' ? 'dark' : 'light')
  return [theme, toggle]
}

function avg(vals: (number | null | undefined)[]) {
  const c = vals.filter((v): v is number => v != null && isFinite(v))
  return c.length ? c.reduce((s, v) => s + v, 0) / c.length : null
}

export default function App() {
  const [tab, setTab] = useState<TabId>('chart')
  const { records, loading, reload } = useRecords()
  const [theme, toggleTheme] = useTheme()
  const latest = records.at(-1)

  return (
    <>
      <button
        className="theme-toggle"
        onClick={toggleTheme}
        title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
        aria-label="Toggle theme"
      >
        {theme === 'light' ? '🌙' : '☀️'}
      </button>

      <div className="page-shell">
        <header className="hero">
          <div className="hero-copy">
            <div className="eyebrow">HOI4 save telemetry</div>
            <h1>Autosave Dashboard</h1>
            <p>Interactive analysis of save timing, system load and campaign growth.</p>
          </div>
          <div className="hero-actions">
            <button className="button button-primary" onClick={reload} disabled={loading}>
              {loading ? 'Loading…' : 'Reload Data'}
            </button>
          </div>
        </header>

        <SummaryGrid cards={[
          { label: 'Visible saves', value: records.length, sub: `${records.length} total in file` },
          { label: 'Latest game date', value: latest?.game_date ?? '—', sub: `${fmtNum(latest?.file_size_mb)} MB` },
          { label: 'Avg write time', value: fmtNum(avg(records.map(r => r.write_duration_seconds))), sub: 'seconds' },
          { label: 'Avg CPU', value: fmtNum(avg(records.map(r => r.cpu_avg))), sub: 'during save' },
        ]} />

        <TabBar active={tab} onChange={setTab} />

        {tab === 'chart'    && <ChartTab records={records} />}
        {tab === 'soldiers' && <SoldiersTab />}
        {tab === 'analyzer' && <AnalyzerTab />}
      </div>
    </>
  )
}
