# Economy & Trade: serialized backend semantics

`AnalyzeResult.economy` is an additive backend contract. Newly parsed saves
include it; older persisted results may omit it. No migration/backfill is done.
`stateBasis: "serialized"` means **state at save time**, not the economy HoI4
would calculate after its next runtime tick. No simulation or stale-state
detector is implemented.

Supported resources: aluminium, rubber, tungsten, steel, chromium, coal.
Oil and Fuel are not implemented. Game-install files are not required at runtime.

## National summaries

Each country with a resource block has six `EconomyResourceSummary` entries.
Absent direct fields remain `null`; explicit zero remains `0`.

| Contract field                    | Serialized source / meaning                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `extracted`                       | `resources.produced` (raw national summary)                                           |
| `imported`                        | `resources.imported`, never reconstructed from incoming trades                        |
| `baseExport`                      | `resources.base_export`                                                               |
| `exportAllocation`                | `resources.to_export`: allocation/outflow, **not** the `exported` summary             |
| `savedExported`                   | `resources.exported`, retained separately; not canonical UI Exported                  |
| `transferOverlordSubject`         | Raw `resources.transfer_overlord_subject` entry, without inferred direction           |
| `projectDemand`                   | `program_status.project_pool.resources`                                               |
| `productionDemand`                | Saved resource `amount` sums, broken down by military/naval/refit/energy              |
| `serializedAvailableBeforeDemand` | First map of the validated three-map `resources.to_use` ledger                        |
| `serializedProjectDemand`         | Magnitude of the saved second-map project contribution                                |
| `serializedProductionDemand`      | Magnitude of the saved third-map production contribution                              |
| `serializedBalance`               | Sum of those saved ledger contributions, not a new calculation from rounded UI values |

Military, naval and `ship_refit_lines` consumers are read at country-production
scope; coal also reads `energy_production_cost`. No demand is inferred from
factory count, equipment cost or resource `need`. `amount` is nominal saved
demand, **not supplied quantity**. `need=0` does **not** establish absence of a
runtime shortage. Absent amounts remain nullable; malformed/incomplete consumer
data prevents a complete total. Unknown ledger layouts return nullable named
ledger fields with warnings, not undocumented array positions.

Within the validated sparse ledger maps, an omitted demand entry contributes
nothing to the balance; its separately exposed raw demand remains null. Missing
availability prevents a balance. Decimal ledger arithmetic does not apply UI
rounding. Export allocation may be fractional (e.g. A aluminium `62.1`), whereas
the saved net availability already reflects the engine's accounting (`352`).
Therefore do not derive balance by subtracting raw allocation from produced, or
by substituting `savedExported` for allocation. Integer UI formatting is a
separate future presentation concern.

## Commercial trades and resource rights

`commercialTrades` reads `countries.<exporter>.resources.export`. `receiver`
identifies the importer; the record's `country` is not an exporter tag. Reference,
raw delivered amount, both efficiency fields, `required_cic`, `lended_cic`, and
raw `request` are retained. The two CIC values are not assumed interchangeable.
No universal nominal contract amount is inferred from CIC or request.

Routes link through the exporter's `resources.delivery_routes.<receiver>` (or
a direct `delivery_route` if present). Type 1 is land, type 2 sea; unknown types
retain their raw value with a null route classification. Land/naval paths and
convoy subscribers are optional. `request` is not interpreted as resource amount.
Convoy `convoys`/`total` retain their serialized values without filling missing
fields with zero. No display rounding is applied to delivered/imported values.

`resourceRightsOrigins` reads `extra_resource_origin` separately: beneficiary,
giver, origin reference, state, raw resource maps (including the save's spelling
`resources_unclapmed`), given-rights tuples, efficiencies and delivery route.
These quantities are **never added** to national extracted/imported. Exact
resource-rights contribution to engine national production is not reconstructed.

National summaries and trade records may be temporally out of sync in a valid
save. This contract preserves both; it does not call the save corrupt or repair it.

## Regression evidence

Compact derived fixtures live in `server/src/hoi4/economy/fixtures/` and always
run. Read-only real-control checks also run when the untracked saves are present:

- A `autosave_100_reload_1192_control_temp.hoi4`: Steel 897 / balance -64;
  Rubber imported 5.57792 / balance 9.57792; coal energy demand 467.
- B `post_load_1h_no_trade_control_temp.hoi4`: Steel 1184 / imported absent /
  balance 205 despite unchanged rights and production demand.
- C `subject_trade_control_temp.hoi4`: Steel imported 24 / balance 229 while
  RKB commercial delivery is 32. `savedExported=160` differs from allocation 178.

The controls are from HoI4 1.19.2.0.3eb1 (85f4). Validated trades include
POR -> GER Tungsten (48, 6/6 CIC, land), INS -> GER Rubber (5.57792,
0.69724 convoy-loss efficiency, 9/9 convoys) and RKB -> GER Steel.
SWE -> GER state 918 rights retain raw 39.2 Tungsten / 43.68 Steel / 16.8 Chromium.
No frontend, Industry, Stockpile, Fielded Equipment, ownership or API endpoint
semantics are changed by this phase.
