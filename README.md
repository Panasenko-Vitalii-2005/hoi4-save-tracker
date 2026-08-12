Review the current repository and turn the existing root `README.md` into a professional portfolio-quality project README.

Do not modify application logic, parser behavior, API contracts, or UI code.

## Project context

The repository is a Hearts of Iron IV save-analysis and telemetry project.

Main parts:

- React + TypeScript + Vite frontend;
- NestJS backend;
- HOI4 save parser;
- Python autosave watcher and telemetry tools;
- charts and country statistics;
- per-country military data;
- war casualties extracted from `war_relation`;
- detailed casualty breakdown by opponent and war;
- tests for parser behavior;
- frontend lint and build are passing;
- backend tests and build are passing.

## Task

Rewrite the root `README.md` so that a developer, recruiter, or HOI4 player can understand the project quickly.

Use clear English.

## Required sections

### 1. Title and short description

Use:

```text
HOI4 Save Tracker
```

Describe it as a local analytics tool for Hearts of Iron IV save files and autosave performance telemetry.

### 2. Key features

Include:

- autosave tracking;
- save duration and performance telemetry;
- CPU and RAM measurements;
- interactive charts;
- country military statistics;
- divisions, manpower, aircraft, ships and industry;
- save-file analyzer;
- war casualties by country;
- per-opponent casualty breakdown;
- responsive React interface;
- tested NestJS parser.

### 3. Screenshots

Add a section with placeholder Markdown entries:

```markdown
![Performance dashboard](docs/screenshots/performance-dashboard.png)
![Country statistics](docs/screenshots/country-statistics.png)
![War casualties](docs/screenshots/war-casualties.png)
```

Do not create fake screenshot files.

### 4. Architecture

Explain this flow:

```text
HOI4 save / autosave
    ↓
Python watcher and telemetry collection
    ↓
JSON records and save files
    ↓
NestJS parser and API
    ↓
React analytics dashboard
```

Also briefly describe:

- `client/`;
- `server/`;
- Python utilities;
- `diagnostics/`.

### 5. Technology stack

Include:

- React;
- TypeScript;
- Vite;
- NestJS;
- Plotly;
- Python;
- Jest.

### 6. Installation and running

Inspect the actual `package.json` files and available scripts.

Document only commands that really exist.

Include separate instructions for:

- backend;
- frontend;
- Python watcher, if its usage can be determined from the code or existing documentation.

Do not invent commands or configuration.

### 7. Tests and verification

Document the real commands for:

- server tests;
- server build;
- client lint;
- client build.

### 8. Data and privacy

Explain that `.hoi4` save files are intentionally excluded from Git because they may be large and contain local campaign data.

Mention that users should provide their own save files locally.

### 9. Current limitations

Include:

- parser depends on HOI4 save-file structure;
- game updates may require parser updates;
- exact per-equipment historical losses are not currently available;
- casualty total is a calculated sum of bilateral `war_relation` entries;
- some diagnostic tools are developer-oriented.

### 10. Roadmap

Use a checklist:

```markdown
- [x] Autosave telemetry
- [x] Country military statistics
- [x] War casualties by country
- [x] Per-war casualty details
- [ ] Naval loss events
- [ ] Air loss analysis
- [ ] Equipment-loss analysis
- [ ] Campaign comparison
- [ ] Export reports
```

### 11. Repository structure

Add a compact tree showing the important folders and files.

Do not include generated folders or save files.

### 12. Portfolio summary

Add a short section explaining the engineering challenges demonstrated by the project:

- parsing a large semi-structured save format;
- backend/frontend type synchronization;
- data aggregation;
- performance-conscious UI;
- testing and regression protection.

## Cleanup review

Inspect these folders:

```text
server/scripts/
diagnostics/
```

Report which files appear to be:

- reusable developer tools;
- one-off investigation scripts;
- safe to keep;
- candidates for deletion or relocation.

Do not delete anything yet.

## Verification

After editing the README:

1. show the modified files;
2. summarize the README structure;
3. list any commands documented;
4. report suspected temporary scripts;
5. do not modify source code.

## Docker

Start the production-like two-container application from the repository root:

```bash
docker compose up --build
```

Open <http://localhost:8081>. The nginx frontend serves the built React SPA and
proxies `/api/*` to the internal NestJS backend. Upload `.hoi4` saves through
the Analyzer; saves are processed from temporary container storage, removed
after analysis, and are not included in either image. Allow Docker enough
memory for decoded late-game or modded saves larger than 100 MiB.

Stop and remove the containers with:

```bash
docker compose down
```
