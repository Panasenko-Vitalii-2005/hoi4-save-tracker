import { useEffect, useState } from 'react'

export interface PlotBase {
  isDark: boolean
  paper_bgcolor: string
  plot_bgcolor: string
  font: { family: string; color: string }
  hoverlabel: { bgcolor: string; bordercolor: string; font: { family: string; color: string } }
}

export function usePlotTheme(): PlotBase {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.getAttribute('data-theme') === 'dark'
  )

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.getAttribute('data-theme') === 'dark')
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => observer.disconnect()
  }, [])

  if (isDark) return {
    isDark: true,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(18,22,32,0.85)',
    font: { family: 'Space Grotesk, sans-serif', color: '#e8edf2' },
    hoverlabel: { bgcolor: '#1e2432', bordercolor: '#d94f2b', font: { family: 'IBM Plex Mono, monospace', color: '#e8edf2' } },
  }

  return {
    isDark: false,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(255,252,247,0.72)',
    font: { family: 'Space Grotesk, sans-serif', color: '#172226' },
    hoverlabel: { bgcolor: '#fff9ef', bordercolor: '#d94f2b', font: { family: 'IBM Plex Mono, monospace', color: '#172226' } },
  }
}
