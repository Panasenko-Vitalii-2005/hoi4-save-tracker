# HOI4 Save Tracker frontend

React/Vite frontend for single-save exploration, Campaign Import, Recent Analyses, Compare Saves, Campaign Trends, storage management, CSV/JSON export, share pages, and printable reports.

See the [root README](../README.md) for the product overview and [Architecture](../docs/architecture.md) for frontend/backend boundaries.

## Run

Requires Node.js 22 and the NestJS backend on `http://localhost:3001`.

```bash
npm ci
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the backend.

Production verification:

```bash
npm test
npm run lint
npm run build
```

The production build is emitted to `server/client/dist` for Nest static serving; the frontend Docker image copies the same build into nginx.

## UI architecture

- `src/components/analyzer/` — upload, Campaign Import, Recent, Compare, storage, and domain analysis views.
- `src/components/chart/` — Campaign Trends and optional autosave telemetry charts.
- `src/components/reports/` — shared print-oriented report shell plus Single, Compare, and Campaign reports.
- `src/lib/data-export.ts` — deterministic CSV/JSON mappings used by views and reports.
- `src/types/` — frontend mirrors of intentional public API contracts.
- `tests/` — Vitest/jsdom interaction and data-contract tests.

The frontend consumes backend summaries directly. It does not parse `.hoi4` text, reconstruct industry formulas, or convert missing data to zero.

## Routes and state

The main application uses client-side view state for Campaign Trends, telemetry, and Save Analyzer. Public shares use `/share/:id`, with nginx and Nest static serving configured for SPA fallback. Report views are in-app states rather than permanent URLs.

## Accessibility and responsive behavior

Interactive table rows support keyboard activation where applicable, selected states are exposed with ARIA, tables scroll horizontally on narrow viewports, and destructive storage actions use an accessible confirmation dialog. Print CSS removes application navigation and interactive-only controls from reports.
