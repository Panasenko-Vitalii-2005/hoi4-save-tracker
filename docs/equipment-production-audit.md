# Equipment & Production Data Audit

## Scope and verdict

This audit is based on the current repository implementation and the real saves
`saves/autosave_99_temp.hoi4`, `saves/autosave_100_temp.hoi4`, and
`saves/autosave_101_temp.hoi4`. No game wiki assumptions are used.

The current parser is already sufficient for a useful, transparent equipment
and current-production view. It can safely expose:

- signed national stockpile balances by exact save-scoped design and exact raw
  equipment definition;
- equipment currently present in canonical land divisions;
- current land/air military-production line allocation;
- current output rate, next-item progress, raw active-slot efficiency, and
  exact resource-shortage records;
- snapshot-to-snapshot changes of definition-level stockpile balances,
  allocation, and complete current output rates.

It cannot currently produce a trustworthy country equipment demand, equipment
deficit/surplus, efficiency cap, lifetime production, resource-loss
percentage, or shortage-recovery estimate. Those must not be inferred from
stockpile signs, division template composition, or `shortage / output`.

## Evidence and methodology

The control save is 99.69 MiB and the current `analyzeSave()` run used for this
audit reported 3.22 seconds. Its regression controls remain:

| Control | Value |
| --- | ---: |
| Game date | `1944.5.1` |
| GER effective MIL | 286 |
| GER effective CIV | 228 |
| GER effective dockyards | 39 |

Relevant real-save locations in `autosave_100_temp.hoi4` are:

- top-level `equipments` registry: line 104,414;
- `light_tank_chassis_2` / Panzer II `70:5894`: lines 196,451-196,460;
- top-level `division_templates`: line 234,020;
- top-level `countries`: line 794,036;
- `countries.GER`: line 794,037;
- `countries.GER.production`: line 802,837;
- first GER `production.military_lines`: line 803,653;
- `countries.GER.production.equipments`: line 805,051;
- GER canonical divisions: `countries.GER.units` at line 811,248;
- a division's direct equipment followed by reinforcement/upgrade requests:
  lines 811,276-811,357;
- occupation-garrison `equipment_need` and
  `garrison_reinforcement_requests`: lines 887,687-887,703.

Only small targeted blocks and parser-produced summaries were inspected. The
save files were not modified.

## Current data flow

```text
top-level equipments
  -> parseEquipmentRegistry
  -> analysis-scoped EquipmentDefinitionRecord lookup

countries.TAG.production.equipments.equipment
  -> parseNationalStockpile
  -> aggregateNationalStockpile
  -> AnalyzeResult.stockpileSummaries
  -> Stockpile UI

countries.TAG.production.military_lines
  -> parseMilitaryProductionLines
  -> aggregateMilitaryProduction
  -> AnalyzeResult.militaryProductionSummaries
  -> Production UI

countries.TAG.units.division.equipment
  + top-level division_templates
  + shared equipment registry
  -> parseDivisions / parseDivisionTemplates / aggregateDivisions
  -> normalized divisionSummaries + divisionEquipmentCatalog
  -> Land Forces current-equipment UI
```

The equipment registry, stockpile parser, production parser, and division
parser all reuse the decoded save, top-level structural index, country
production index, and equipment registry in the integrated path.

The current Compare DTO contains only strategic country/totals metrics. The
current Campaign Trends DTO contains strategic global/country metrics. Neither
currently projects stockpile or production data, even though the persisted
`AnalyzeResult` contains it.

### Public fields already exposed

`AnalyzeResult.stockpileSummaries` exposes country, raw definition, exact
variant reference, variant name, amount, version, creator/origin, obsolete
state, and unresolved entries.

`AnalyzeResult.militaryProductionSummaries` exposes country and definition
totals plus each line's line/equipment references, design metadata, priority,
requested/active/queued/damaged factories, current items/day, next-item
progress, active-slot efficiency average/min/max, resource shortages,
manufacturer reference, completeness, and warnings.

`AnalyzeResult.divisionSummaries` exposes each canonical division's exact
equipment occurrences as `{ equipmentRef, amount }`.
`divisionEquipmentCatalog` exposes reusable definition/design metadata.
`divisionTemplateCatalog` exposes battalion/support slot composition, not
equipment requirements.

## Equipment identity

### Exact identity within one save

The authoritative exact design identity is the composite reference:

```text
{ type, id }
```

All 7,411 registry records in `autosave_100_temp.hoi4` use type 70, have 7,411
unique composite references, and have no duplicate references. The composite
form must nevertheless be retained because parsers deliberately support other
types and malformed/modded data.

The registry key surrounding each record is an exact raw definition such as
`light_tank_chassis_2`. It is not a broad product category. For Panzer II:

```text
equipmentRef:       70:5894
definition:         light_tank_chassis_2
name:               Panzer II
version:            6
parentEquipmentRef: 70:5343
creatorTag:         GER
originTag:          ---
obsolete:           false
designTeamRef:      79:9
```

Names are display metadata, not identity. In the control registry, 354
different references are named `Early Destroyer`; `Sd.Kfz. 11` occurs on 20
references. Names may also be null.

### Safe aggregation levels

1. **Exact design/variant:** composite `equipmentRef`, within one analysis.
   Preserve definition, name, version, creator/origin, obsolete state, and
   parent separately.
2. **Exact raw equipment definition:** `definition`, for example
   `infantry_equipment_2` or `medium_tank_chassis_3`. This is the safest
   user-understandable aggregation and works with modded open-ended strings.
3. **Game archetype/family:** not currently resolved by the registry parser.
   Reinforcement queues sometimes use broader keys such as
   `infantry_equipment`, but no approved mapping joins every exact definition
   to such a key.
4. **Broad UI category** such as Infantry, Tanks, Aircraft, or Support:
   unsupported without an explicit, mod-aware taxonomy. Substring heuristics
   are not acceptable.

`parentEquipmentRef` describes a registry relationship, but is not proven to
be a complete broad-category hierarchy and must not be used as one.

## National stockpile semantics

The exact source is:

```text
countries.TAG.production.equipments.equipment = {
  id = { id = ... type = ... }
  amount = ...
}
```

The parser accepts only direct entries under this hierarchy. It does not mix
global registry definitions, division equipment, production lines, or nested
lookalikes into the stockpile.

The `amount` is a signed decimal stockpile-accounting balance. It is not a
count of deployed equipment and is not guaranteed to be a non-negative whole
number. The control save contains 46 negative exact-variant balances. For
example, SOV has `-0.4816` of the obsolete MON-created
`infantry_equipment_0` reference `70:207`; USA has `-20` of the CHI-created
`convoy_1` reference `70:112`.

GER examples in `autosave_100_temp.hoi4`:

| Exact definition/design | Amount |
| --- | ---: |
| `anti_air_equipment_1`, all designs | 3,054 |
| GER design `70:1331` | 1,117 |
| FRA design `70:1551` | 399 |
| BEL design `70:4803` | 316 |
| HOL design `70:1636` | 315 |
| `train_equipment_2`, all designs | 477 |
| `light_tank_flame_chassis_2` / Flammpanzer II | 138 |

The foreign creator tags within GER's balance prove that captured/transferred
foreign designs remain distinct. They must not be merged by display name.

Deployed equipment is excluded from this container. Panzer II `70:5894` is
absent from GER's stockpile entries but is present on production and totals 468
items in GER canonical divisions. Therefore adding stockpile and division
equipment would mix two distinct states and still would not yield total demand.

The existing UI wording **National stockpile balances** is appropriately
precise when accompanied by its signed-decimal explanation. Plain
`National Stockpile` is acceptable as a navigation label, but a physical
`units available` interpretation is not.

The save does not indicate, on a stockpile entry itself, what part is reserved
for reinforcement, upgrade, lend lease, deployment, or another subsystem.

## Canonical deployed land equipment and a legacy caveat

The canonical current-division source is the direct container:

```text
countries.TAG.units.division.equipment.equipment = {
  id = { id = ... type = ... }
  amount = ...
}
```

For GER, the control result contains 365 canonical divisions, 2,908 equipment
occurrences, 173 exact referenced designs, and 25 exact definitions. Examples:

| Definition | Amount present in canonical GER divisions |
| --- | ---: |
| `infantry_equipment_2` | 247,143.9625 |
| `support_equipment_1` | 9,069 |
| `artillery_equipment_3` | 9,045 |
| `motorized_equipment_1` | 7,220 |
| `medium_tank_chassis_3` | 2,377 |
| `light_tank_chassis_2` | 639 |
| exact Panzer II `70:5894` | 468 |

This means only **equipment currently recorded in canonical land divisions**.
It excludes stockpile, air wings, naval equipment, occupation garrisons, and
other queues.

The older `equipment_by_country` / `world_equipment` path is not suitable for
new correctness-sensitive analytics. It regex-scans an entire division block,
so it also sees nested `equipment` entries inside reinforcement/request state.
For GER it reports 251,872 `infantry_equipment_2`, versus 247,143.9625 from the
canonical direct division containers; similar positive inflation exists for
support equipment (+264), artillery 3 (+293), motorized (+140), and other
definitions. It also rounds to one decimal. The existing Overview equipment
chart consumes this legacy field. A future intelligence view should use
`divisionSummaries` plus `divisionEquipmentCatalog`, not this legacy map.

## Military production-line semantics

The exact source is direct `countries.TAG.production.military_lines` blocks.
Across all 604 control-save lines, the complete set of direct fields is:

```text
scalar:
  active_factories amount cost damaged_factories priority produced
  queued_factories requested_factories speed

blocks:
  equipment_variant_index factory_efficiencies id
  industrial_manufacturer resources
```

No line-local creation date, start date, lifetime-produced count, efficiency
cap, or modifier breakdown is present.

| Candidate | Save field | Real GER Panzer II value | Interpretation | Confidence |
| --- | --- | --- | --- | --- |
| Line identity | `id` | `56:446` | Analysis/campaign line reference; not equipment identity | High within a snapshot |
| Produced design | `equipment_variant_index` | `70:5894` | Exact registry design produced by the line | High |
| Priority | `priority` | `0` | Stored production-line order/priority value | High as raw state |
| Requested factories | `requested_factories` | `4` | Requested line allocation | High |
| Active factories | `active_factories` | `4` | Active slots recorded on the line | High |
| Queued factories | `queued_factories` | absent/null | Queued allocation when serialized; absence is not zero at exact-line boundary | High |
| Damaged factories | `damaged_factories` | absent/null | Damaged allocation when serialized | High |
| Current progress numerator | `produced` | `1.60678` | Work accumulated toward the next item | High after temporal validation |
| Cost | `cost` | `10.5925` | Current line item cost denominator | High as raw state |
| Current speed | `speed` | `34.6725` | Current production work per day after runtime effects | High after temporal validation |
| Efficiency slots | `factory_efficiencies` | first four values are `115` | Per-factory raw HOI4-scale efficiency values | High as raw state |
| Resources | `resources` | steel `amount=8 need=0`; chromium `4/0` | Allocated/available amount and unmet need for the line | High for `need > 0` signal |
| Manufacturer | `industrial_manufacturer` | `79:9` | Exact manufacturer reference, without resolved effect breakdown | High as reference |
| `amount` | `amount` | `-1` | Sentinel/configuration state; **not** output count | High |

All 604 production lines in the control save have `amount=-1`, proving it
cannot represent lifetime output.

Current public summaries preserve nulls on exact lines, while country and
definition factory totals use documented effective zeroes for missing optional
factory fields. In the control save:

- 604 lines and 604 definition summaries across 114 countries;
- 535 lines have a current rate and 69 do not;
- 590 lines have next-item progress and 14 do not;
- 67 lines have no active factory count;
- 80 lines have non-zero queued factories (135 total);
- 3 lines have damaged factories (3 total);
- 74 lines have exact resource-shortage signals;
- all equipment references resolve in this save.

Production covers current land/air `military_lines`. Naval construction and
refits are separate structures and are intentionally excluded.

## GER factory-allocation reconciliation

GER's 20 production definitions/lines in the control save record:

| Exact definition | Active / requested MIL | Current items/day |
| --- | ---: | ---: |
| `infantry_equipment_2` | 94 / 94 | 1,382.7935 |
| `artillery_equipment_3` | 39 / 39 | 71.8218 |
| `small_plane_airframe_2` (Fw 190) | 38 / 38 | 10.6968 |
| `medium_tank_chassis_3` (Panther) | 36 / 36 | 13.4939 |
| `support_equipment_1` | 29 / 29 | 57.6018 |
| `small_plane_cas_airframe_2` | 15 / 15 | 3.6295 |
| `motorized_equipment_1` | 14 / 14 | 44.9519 |
| `anti_tank_equipment_3` | 11 / 11 | 14.5430 |
| `light_tank_chassis_2` (Panzer II) | 4 / 4 | 3.2733 |
| remaining eleven definitions | 12 / 12 | definition-specific |
| **Line total** | **292 / 292** | not summable across unlike equipment |

The known effective military-factory total is 286, so line-active slots exceed
it by 6. The same relationship occurs in adjacent snapshots:

| Save/date | Active line slots | Effective MIL | Difference |
| --- | ---: | ---: | ---: |
| 99 / `1944.4.1` | 285 | 280 | +5 |
| 100 / `1944.5.1` | 292 | 286 | +6 |
| 101 / `1944.6.1` | 294 | 289 | +5 |

This is not explained by naval production (excluded), queued slots (zero), or
line-level damaged factories (zero for GER). Occupation/subject factories are
already components of effective MIL, but the save provides no per-line source
attribution.

The mismatch is not unique to GER: six countries have active-line totals above
their computed effective MIL in the control result; JAP is 73 versus 49. At
world level, the opposite direction dominates: 2,276 active line slots versus
2,338 effective MIL, with 2,414 requested, 135 queued, and 3 damaged.

Therefore the save exposes two valid but non-conserved runtime snapshots:

- effective national military factories; and
- active/requested/queued/damaged slots recorded on production lines.

The data proves their values, but not a universal conservation rule or the
reason for each discrepancy. Possible runtime timing and subsystem semantics
must not be promoted as fact. A UI may accurately answer **where recorded
production-line slots are allocated**, but must not calculate `unused MIL =
effective MIL - active` or an allocation percentage against effective MIL.

## Current output/day and progress

The current parser derives:

```text
currentItemsPerDay = speed / cost
progressFraction   = produced / cost
```

only when inputs are finite and cost is positive. Missing speed remains null;
it is never converted to zero. Definition output is complete only when every
line has a known rate; otherwise the API exposes a known partial sum and marks
the aggregate incomplete.

Panzer II proves both formulas:

```text
34.6725 / 10.5925 = 3.2733065848477696 items/day
1.60678 / 10.5925 = 0.15169034694359218 progress
```

Temporal validation is exact:

- save 99 progress `0.9524928015105029` plus 30 days at
  `3.2733065848477696/day` has fractional remainder
  `0.15169034694359218`, exactly save 100;
- save 100 progress plus 31 May days has fractional remainder
  `0.6241944772244513`, exactly save 101.

This makes current items/day **EXACTLY DERIVABLE** snapshot state, not an
approximation. It is not realized historical output and must not be summed
across unlike equipment definitions.

`produced` wraps as items complete, as the adjacent progress values show. The
save line has no lifetime counter. Total produced between arbitrary saves is
unsupported because rates and lines may change between snapshots.

## Production efficiency

The save stores an array of raw efficiency values per possible factory slot.
The aggregator uses only the first `floor(active_factories)` finite values and
publishes their average, minimum, and maximum. It warns on non-integer active
counts or incomplete active-slot coverage.

In the control save, 537/604 lines have active efficiency metrics. Active-line
averages range from 1 to 123 and individual active-slot extrema from 1 to 124.
Examples include GER Panzer II average/min/max 115, GER train equipment 120,
and ENG train equipment 123. Values above 100 prove that normalizing to 0..1
or clamping at 100 is wrong.

No direct line-local efficiency-cap field exists. Searches for an efficiency
cap did not find one in the save. Country dynamic modifiers include some
efficiency-gain/retention-related values, but reconstructing a cap or the
game's presentation percentage would require game rules and modifier
composition not present in the current production contract.

Safe UI wording is **raw HOI4 efficiency value across active factory slots**.
The raw average/range is safe; an exact cap or normalized percentage is not.

## Resource shortage and penalty

Each line's `resources` entries contain `resource`, `amount`, and `need`.
`need > 0` is a direct, line-specific shortage signal. For example, control
save BOL has:

- anti-tank equipment 2: chromium `amount=0`, `need=1`;
- motorized equipment 1: rubber `amount=0`, `need=2`;
- support equipment 1: aluminium `amount=0`, `need=3`.

GER Panzer II has steel `8/0` and chromium `4/0`, so it has no recorded
resource shortage. The current UI correctly shows exact amount/need values and
does not invent severity.

The save's `speed` is the current post-runtime line speed, but there is no
line-local counterfactual speed without shortages and no exact penalty scalar.
Resource substitution, country modifiers, manufacturer effects, and game
defines are not decomposed by the parser. Therefore:

- **Production limited by resources:** safe when any exact `need > 0` exists;
- exact missing resources: safe;
- exact percentage of output lost to resources: unsupported;
- a resource bottleneck score: unsupported.

## Equipment requirements, reinforcement, and upgrades

The save contains more demand-related state than the current parser exposes,
but it is not a single country demand total.

### Division requests

Canonical divisions may contain:

```text
requests = {
  reinforcement = {
    manpower_pool = { ... }
    request = {
      need = { support_equipment = 24 }
      date = "1943.12.20.2"
    }
    request = {
      total_progress = 6.6918
      need = { infantry_equipment = 241 }
      date = "1944.3.7.6"
    }
  }
  upgrades = {
    request = {
      request = 9
      total = 1010
      equipment_variant_index = { id = 3956 type = 70 }
    }
  }
}
```

In save 100, 1,418 of 3,250 divisions have a reinforcement block containing
3,629 requests; 624 requests already contain a `produced` block and 1,575 have
progress state. There are 2,579 divisions with upgrade blocks and 4,540
upgrade requests. Naively summing `need` yields archetype-level numbers, but
that would combine requests at different progress/delivery states and would
not explain whether `need`, `produced`, or their difference is currently
outstanding.

The counts and naive sums change in saves 99/100/101, confirming transient queue
state, but not validating a balance formula.

### Occupation garrisons

Occupation state separately stores current garrison equipment,
`equipment_need`, and `garrison_reinforcement_requests`. The control save has
347 `equipment_need` blocks and 327 garrison reinforcement-request blocks.
These are outside canonical division equipment and must be accounted for
separately if a future total demand model is attempted.

### Templates

Division templates directly store regiment/support slot types and coordinates.
They do not store equipment quantities, equipment costs, or a resolved total
requirement. Turning battalion composition into equipment requirements would
require external game/mod definitions and runtime modifiers.

### Correct classification

- current equipment in canonical land divisions: **DIRECT and safe**;
- raw reinforcement/upgrade/garrison request records: **exist, but are not
  parsed and need a dedicated semantics audit**;
- full template requirement: **not available from current save contracts**;
- total army equipment demand: **unsupported**;
- equipment shortage/surplus: **unsupported**;
- stockpile minus division requirement: **invalid**.

The presence of a negative signed stockpile balance is not sufficient evidence
of a reinforcement deficit. Production resource shortage is also a different
concept from equipment shortage.

## Recovery estimate verdict

An estimate such as `shortage recovery: 51 days` is **not defensible**. The
current implementation lacks a validated outstanding shortage quantity and
does not model continuing combat loss, attrition, upgrades, lend lease,
captures, conversion, deployment, or changing production allocation/rate.

Even if a future parser validates reinforcement requests, simply calculating
`request / currentItemsPerDay` would still be a static no-consumption scenario,
not a recovery prediction. Do not implement this metric yet.

## Cross-save identity and comparison

All comparison semantics must remain `Target - Base` and should only be
presented as campaign-continuous when exact `game_unique_id` compatibility is
known.

### Observed adjacent-save behavior for GER

| Identity | 99 -> 100 evidence | Consequence |
| --- | --- | --- |
| Production line refs | 19/20 shared | Useful continuity hint, not a stable grouping key |
| Same production item, new line ref | Flammpanzer II `56:5924` -> `56:6292`, same `70:4551` | Do not require a stable line ID |
| Same line, different design | line `56:1396`: `70:4642` Minenräumer -> `70:7371` Panzerbefehlswagen | A line ref is not equipment identity |
| Same line/name, new variant | line `56:3417`: Sd.Kfz. 251 `70:7320` v7 -> `70:7403` v9 | Names cannot join exact variants |
| Stockpile exact refs | 56/57 shared | Exact ref deltas work when a ref persists; additions/removals must remain explicit |
| Definition-level stockpile | 21 definitions in all three saves | Best stable user-facing key |

GER total stockpile balance changes 4,676 -> 4,759 -> 4,723. Its local
anti-air design `70:1331` changes 1,121 -> 1,117 -> 1,024 even though its
production line runs at about 2.195 items/day. This proves stockpile delta is a
net balance change affected by multiple flows, not historical production.

### Recommended comparison keys

- definition-level stockpile/allocation/output: `countryTag + exact raw
  definition`;
- exact variant stockpile drilldown: `countryTag + equipmentRef`, treating
  absent refs as explicit additions/removals and never joining by name;
- production line drilldown: `countryTag + lineRef` only as a continuity hint;
- exact produced design: `equipmentRef` inside each snapshot;
- comparisons must surface incomplete output rather than substitute zero.

Safe Compare metrics are stockpile-balance delta, active/requested/queued/
damaged factory delta by exact definition, complete current-rate delta, and
resource-shortage state/need changes. They are snapshot differences, not
production, consumption, or equipment loss between saves.

## Campaign Trends suitability

Good trend keys are stable, low-cardinality exact definitions for a selected
country:

- stockpile balance by exact definition;
- active/requested production slots by exact definition;
- current items/day by exact definition, with completeness retained;
- resource-shortage line count or exact resource need for a selected
  definition.

Exact variant and line-ref trends are high-cardinality and susceptible to
replacement. They are better as drilldown events than default chart series.
Raw progress is cyclic and unsuitable for a long-term trend. Raw efficiency
can be trended only with explicit weighting/completeness semantics; it is not a
percentage.

Every persisted analysis that the current persistence service considers
readable is required to contain `stockpileSummaries`,
`militaryProductionSummaries`, `divisionSummaries`, and the division catalogs.
Campaign Trends already loads persisted AnalyzeResults sequentially and uses no
save file, parser, or Worker. Consequently the existing readable 179-snapshot
campaign already contains the source data needed for these historical
equipment trends; no save reparse or original `.hoi4` file is required.

The Campaign Trends DTO/service must be extended to project selected/bounded
equipment series. That is an API/DTO/product change, not a parser or
`AnalyzeResult` change. A truly old artifact lacking the required arrays is
already incompatible with the current persistence validator and would need
reanalysis, but it is not part of the currently readable 179 snapshots.

## Scale, payload, and performance

Control-save scale and uncompressed JSON contributions:

| Data | Count | JSON bytes |
| --- | ---: | ---: |
| Full `AnalyzeResult` | one save | 6,871,628 |
| Stockpile summaries | 113 countries / 1,033 definitions / 1,691 variants | 372,073 |
| Production summaries | 114 countries / 604 definitions / 604 lines | 626,545 |
| Division equipment occurrences | 20,486 | included in normalized division payload |
| Division equipment catalog | 737 used refs | 181,529 |

The equipment registry itself has 7,411 records, but the full registry is not
exposed publicly. Existing public summaries already contain the inputs needed
for the safe metrics, so new post-parse aggregation is linear in at most a few
thousand records and should be cheap compared with the 3.22-second full parse.

Do not send every country's full stockpile/production detail for all 179
snapshots. At control-save size that would be about 178.7 MB uncompressed for
stockpile plus production alone. Instead use a bounded server-side projection
for the selected campaign/country/definitions.

For GER in one snapshot, full stockpile and production summaries are 11,597
and 20,471 bytes. A compact definition-level projection is 4,174 bytes; 179
equivalent snapshots project to about 747 KB before normal response overhead.
This is practical without changing persistence or reparsing saves.

## Feature matrix

`Definition` below means the exact open-ended save definition such as
`infantry_equipment_2`, not a broad category.

| Metric / Feature | Existing parser support | Exists in save | Correctly derivable | Confidence | Needs parser change | Needs AnalyzeResult change | Single Save | Compare | Trends | MVP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| National stockpile balance | Yes | Direct `production.equipments.amount` | Yes, signed decimal by definition/ref | High | No | No | Yes | Yes, balance delta | Yes | Yes |
| Exact equipment variant/design | Yes | Composite ref + registry metadata | Yes within snapshot | High | No | No | Yes | Yes with add/remove semantics | Drilldown only | Yes |
| Exact equipment definition | Yes | Registry key | Yes | High | No | No | Yes | Best key | Best key | Yes |
| True game archetype/family | Partial: request keys only, no registry mapping | Partial | Not universally | Low | Yes | Possibly | Not as fact | No | No | No |
| Broad category | No | No authoritative mapping | No | Low | External/mod-aware taxonomy | Possibly | No | No | No | No |
| Active/assigned MIL slots | Yes | Direct per line | Yes, by line/definition | High | No | No | Yes | Yes | Yes | Yes |
| Requested MIL slots | Yes | Direct per line | Yes | High | No | No | Yes | Yes | Yes | Yes |
| Queued/damaged line slots | Yes | Optional direct fields | Yes with null preserved | High | No | No | Yes | Yes | Possible | Yes |
| Unused MIL | Inputs exist but are non-conserved | Separate runtime values | No universal subtraction | High negative finding | No formula fix known | No | No | No | No | No |
| Raw production efficiency | Yes | Direct per-slot array; summary published | Yes, active-slot avg/min/max | High as raw scale | No | No | Yes | With completeness caveat | With weighting caveat | Yes, line level |
| Efficiency cap / normalized percent | No | No direct line cap | No | High negative finding | Yes plus game rules | Yes if approved | No | No | No | No |
| Current daily output | Yes | `speed` and `cost` | Exactly `speed / cost` when valid | High | No | No | Yes | Yes by definition | Yes by definition | Yes |
| Lifetime/total produced | No | `amount=-1`; progress wraps | No | High negative finding | Unknown/external history | Yes | No | No | No | No |
| Next-item production progress | Yes | `produced`, `cost` | Exactly `produced / cost` | High | No | No | Yes | Snapshot-only | No (cyclic) | Yes |
| Resource-shortage signal | Yes | `resources.need > 0` | Yes | High | No | No | Yes | Yes | Selected definition | Yes |
| Exact resource output penalty | No | No counterfactual speed/penalty scalar | No | High negative finding | Yes plus game rules | Yes | No | No | No | No |
| Current canonical division equipment | Yes | Direct division equipment | Yes, present amount only | High | No | No | Yes, clearly scoped | Yes, snapshot delta | Selected definition, caveat | Optional MVP |
| Full deployed equipment across all land subsystems | No | Split across divisions/garrisons/queues | Not currently | Medium | Yes | Yes | No | No | No | No |
| Reinforcement need | No | Division and garrison request structures exist | Semantics not validated | Medium existence / low interpretation | Yes | Yes | Research-only | No | No | No |
| Upgrade need | No | Division upgrade requests exist | Semantics not validated | Medium existence / low interpretation | Yes | Yes | Research-only | No | No | No |
| Total template equipment requirement | No | Template composition only | Requires external game/mod data | High negative finding | Major new resolver | Yes | No | No | No | No |
| Total equipment demand | No | Fragmented/incomplete | No | High negative finding | Major research/parser work | Yes | No | No | No | No |
| Equipment shortage/surplus | No | No validated demand balance | No | High negative finding | Depends on demand work | Yes | No | No | No | No |
| Recovery / days-to-cover estimate | No | Missing validated shortage and consumption | No | High negative finding | Major model/history work | Yes | No | No | No | No |

## Product recommendation

### SAFE NOW

- Keep the existing signed **National stockpile balances** view and exact
  design drilldown.
- Keep the current military-production line view: exact design/definition,
  active/requested/queued/damaged slots, current items/day, next-item progress,
  raw efficiency average/range, and exact resource needs.
- Add an exact-definition allocation chart/table for a selected country. Rank
  by active line slots, not by a synthetic production score. For GER the
  leading definitions are infantry equipment 2 (94), artillery 3 (39), Fw 190
  airframe (38), Panther chassis (36), and support equipment (29).
- Optionally add **Equipment present in canonical divisions**, sourced only
  from normalized division data and clearly excluding stockpile, garrisons,
  air, and navy.
- Add Compare projections using `Target - Base` for definition-level stockpile
  balance, factory slots, complete current rate, and resource-shortage state.
- Add bounded Campaign Trends for a selected country and a small number of
  exact definitions. Reuse persisted results; do not reparse saves.
- Preserve raw definitions and unknown/modded strings. Never classify them by
  substring.

### NEEDS MORE PARSER WORK

- Dedicated division reinforcement-request parser with explicit treatment of
  need, produced/in-transit equipment, progress, dates, manpower pools, and
  duplicate/current-state semantics.
- Dedicated upgrade-request parser and validation of `request`, `total`, and
  target variant meaning.
- Occupation-garrison equipment/current/need/request parser.
- A proven reconciliation model across canonical divisions, garrisons,
  deployments, and queues.
- A game/mod-aware exact definition-to-archetype taxonomy if product grouping
  beyond raw definitions is required.
- Resolution of manufacturer/modifier effects and efficiency cap only if game
  data and full modifier composition are deliberately introduced.
- Replacement of the legacy Overview `equipment_by_country` source with the
  canonical normalized division source should be a separate correctness PR.

### DO NOT IMPLEMENT YET

- equipment shortage/surplus;
- total equipment demand or full template requirement;
- recovery days;
- expected future production after losses/consumption;
- exact resource penalty percentage;
- normalized/clamped efficiency percentage or efficiency cap;
- lifetime production or produced-between-saves from two snapshots;
- unused MIL derived from effective MIL minus active line slots;
- broad Infantry/Tank/Aircraft/Support categories based on names/substrings;
- country production power, strategic scores, or sums of heterogeneous
  items/day;
- line-ID-based long-term charts;
- interpreting stockpile delta as production, consumption, or losses.

## Exact bounded MVP

The first Equipment & Production Intelligence iteration should be a thin
composition of already public, proven data rather than a new parser:

1. **Country snapshot header**
   - exact effective MIL shown independently;
   - number of current military lines and definitions;
   - active/requested/queued/damaged line slots;
   - explicit note that line slots do not reconcile universally to effective
     MIL and are not factory ownership.
2. **Stockpile balances**
   - exact definition, signed amount, design count;
   - exact design drilldown with ref-backed identity, name/version,
     creator/origin, obsolete state, signed amount.
3. **Current production allocation**
   - exact definition, active/requested slots, complete/known current rate,
     shortage-line count;
   - exact line drilldown with design, queued/damaged, next-item progress, raw
     efficiency average/range, exact resource amount/need.
4. **Optional current division equipment**
   - aggregate canonical division occurrences by exact definition and design;
   - label the scope explicitly and do not call it requirement or demand;
   - do not use `equipment_by_country`.
5. **Compare**
   - same-campaign `Target - Base` definition-level balance/allocation/current
     rate deltas;
   - retain null/incomplete states and exact additions/removals.
6. **Trends**
   - selected country plus a bounded selection of exact definitions;
   - stockpile balance, active/requested slots, and complete current rate;
   - compact server DTO built from existing persisted AnalyzeResults.

No parser behavior or `AnalyzeResult` shape is required for this MVP. Compare
and Trends need purpose-built DTO/service/frontend additions only. Demand,
shortage, broad categorization, and prediction remain outside scope.
