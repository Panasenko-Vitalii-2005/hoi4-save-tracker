# Equipment display names

The stockpile parser preserves the save's literal equipment `name`. When that
field is absent, the frontend resolves a display label from the equipment's
creator tag and definition, then the existing generic definition map, then the
unchanged raw definition. This does not change equipment refs or amounts.

`client/src/lib/equipmentCountryNames.generated.ts` is a deterministic,
reviewable English-label subset generated from the developer-supplied official
HoI4 `localisation/english/equipment_l_english.yml`. The generator reads the
keys in `client/src/lib/equipmentNames.ts` as its supported-definition
allowlist, retaining only `TAG_definition` entries. It excludes version,
description, support-weapons, and other unrelated keys. No game installation
or localization file is accessed by the deployed application.

To regenerate after reviewing a game localization update, from `client/` run:

```powershell
npm run equipment:names:generate -- "<path-to-equipment_l_english.yml>"
npm run equipment:names:generate -- "<path-to-equipment_l_english.yml>" --check
npm run equipment:names:test
```

The generated header records the source SHA-256, not a developer machine path.
Review the resulting diff before use. Full localization keys are used by
default; `_short` keys are excluded. The single documented exception is
`JAP_anti_air_equipment_2_short`, whose `Type 2 20 mm` label was verified in
the HoI4 Logistics UI. Other short labels are not substituted automatically.

The data remains an intentionally limited subset, not a general game
localization system. Modded or unsupported definitions retain a generic or raw
technical fallback, and names may differ with game version or localization.
The original localization belongs to the game publisher; do not vendor the
entire file, and review redistribution rights for generated subsets before
public distribution.
