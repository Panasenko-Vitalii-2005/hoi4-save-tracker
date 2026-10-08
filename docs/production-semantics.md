# Production saved-state semantics (External Alpha B1)

Production describes **serialized save state**, not simulated runtime supply
or realized output. This qualification applies equally to new analyses,
legacy gzip artifacts, public shares, reopened analyses, Compare and Trends.
Industry, Stockpile, Fielded Equipment and Economy calculations are unchanged.

## Contract and calculation

`AnalyzeResult.militaryProductionSummaries` and the existing Compare/Trends
contracts keep their field names and arithmetic for backward compatibility.
There are no aliases, migrations, new metrics or artifact rewrites.

| Legacy field | Qualified meaning |
| --- | --- |
| Parsed resource `amount` | Saved nominal resource demand; not current supplied/available quantity |
| Parsed resource `need` | Raw saved diagnostic, nullable when absent; unverified runtime meaning |
| `resourceShortages` | Only entries with finite positive saved `need`, in source order; their `amount` may be null |
| `hasResourceShortage` | Whether that legacy diagnostic list is nonempty; false does **not** confirm sufficient supply |
| `resourceShortageLineCount` | Count of lines with positive saved `need`, not verified runtime shortages |
| `currentItemsPerDay` | Saved `speed / cost` for finite positive inputs, otherwise null; not guaranteed realized output |
| `knownCurrentItemsPerDay` | Deterministic sum of known saved-derived line rates, not a zero substitute for missing rates |
| `outputComplete` / `productionRateComplete` | Saved-rate coverage only, not runtime validation |
| `progressFraction` | Unclamped saved `produced / cost`, not cumulative production |
| Active-slot efficiency | Raw saved scale, not an inferred shortage penalty or efficiency cap |

The public line summary historically retained only positive-need resource
entries, not every parsed resource entry. B1 does not invent a full resource
allocation history for old payloads. Missing rate/diagnostic amounts remain
unavailable; an empty diagnostic list means no positive entries were retained,
not that no shortage existed. A missing metric never becomes a measured zero.
Existing factory-count aggregate conventions are unchanged.

## Controlled evidence

HoI4 `1.19.2.0.3eb1 (85f4)`, GER line `56:1738`, equipment `70:6847`,
`anti_tank_equipment_3` / `12.8 cm PaK 44`:

| Observation | A: immediately post-load | B: one hour, no new trade |
| --- | ---: | ---: |
| Save date | 1944.5.1.2 | 1944.5.1.3 |
| Saved Tungsten `amount / need` | 22 / 0 | 22 / 0 |
| Saved Steel / Chromium amount | 33 / 11 | 33 / 11 |
| Saved speed / cost | 84.64039 / 5.82 | 84.64039 / 5.82 |
| Saved produced | 4.58278 | 4.58278 |
| UI Tungsten supplied | 1 / 22 | 22 / 22 |
| UI output/day | 7.74 | 14.54 |

Source controls: `autosave_100_reload_1192_control_temp.hoi4` and
`post_load_1h_no_trade_control_temp.hoi4`. The compact test transcription is
`server/src/hoi4/production/fixtures/pak44-control.fixture.ts`; the manual UI
oracle is evidence, never a parser input. The equal saved rate/diagnostics
cannot establish equal runtime output/supply. A displayed saved-derived rate
may happen to agree with runtime output, but that is not a general guarantee.

## Product presentation and scope

EN/RU Production labels use **saved-derived rate**, **saved nominal demand**
and **raw saved need**. Empty diagnostic lists explicitly avoid a no-shortage
guarantee. Compare differences and Trends legends, hover labels and per-day
units describe the same saved-derived arithmetic. Exact equipment definition
IDs, telemetry section IDs and stored preference metric IDs remain unchanged.
Incomplete rates retain null deltas/gaps, not partial totals presented as full.

Current Single Save/Comparison/Campaign reports and CSV/JSON report exports
include strategic/industry metrics, not Production rates or need diagnostics.
Their scope stays unchanged. Raw AnalyzeResult/API/gzip data retains legacy
keys under the meanings above. No unsupported output claim is added to reports.
Campaign Intelligence still excludes rates/need-based shortage rules.

No runtime supply, shortage, penalty, realized-output reconstruction, next-tick
simulation, new production metric or new Intelligence rule is implemented.
The precise runtime meaning of `need` and all effects modifying final output
remain unresolved. Historical observations in the
[equipment-production audit](equipment-production-audit.md) are retained, but
its stronger output/shortage interpretations are superseded by this control.
