# Frontend localization

The React client supports English (`en`) and Russian (`ru`). English is the
default and fallback language. An explicit selection is stored under
`hoi4-language` in browser `localStorage`; when no choice exists, a Russian
browser locale may select Russian initially and every other locale safely uses
English. Changing language updates the application immediately and synchronizes
the document `<html lang>` attribute.

Localization uses `i18next` with `react-i18next`. Resources live in:

- `client/src/i18n/en.ts` — canonical English resource and key shape;
- `client/src/i18n/ru.ts` — Russian UI translations;
- `client/src/i18n/index.ts` — initialization, fallback, persistence and locale helpers.

Use stable semantic keys through `useAppTranslation()`, for example
`analysis.sections.production` or `common.cancel`. Add a key to the English
resource first, then its Russian equivalent. To add another language, add a
resource file, register it in `src/i18n/index.ts`, and expose it in the language
selector.

This layer translates presentation strings only. Backend/API error codes,
telemetry event names and section identifiers, database values, country tags,
country/equipment/division names, campaign labels, and all other save-derived
game data remain unchanged. Stable backend error codes are mapped to localized
messages only at the frontend presentation boundary.
