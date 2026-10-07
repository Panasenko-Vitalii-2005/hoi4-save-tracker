export const enIntelligence = {
  title: "Campaign Intelligence",
  snapshotCount: "{{count}} available snapshots",
  from: "From snapshot",
  to: "To snapshot",
  selectSnapshot: "Select a snapshot",
  disclaimer:
    "Insights are based on serialized save states. They describe recorded co-occurring changes, not proven causes.",
  unknownCampaign:
    "Campaign Intelligence requires a known campaign identity. Legacy analyses remain available in Trends.",
  insufficientHistory:
    "No eligible default window is available. Choose two snapshots with different valid game dates and compatible game versions.",
  selectWindow: "Choose a country and both snapshot endpoints.",
  loading: "Loading Campaign Intelligence…",
  empty:
    "No supported Campaign Intelligence patterns were detected for this window.",
  incomplete:
    "Some required metrics are missing. No supported pattern was detected in the available data; not all patterns could be evaluated.",
  ineligible: "Temporal interpretation is unavailable for this window.",
  unsupportedTitle: "Unsupported insight",
  unsupportedBody:
    "This insight cannot be interpreted by this version of the interface. Its recorded evidence remains available.",
  showEvidence: "Show evidence",
  hideEvidence: "Hide evidence",
  showTechnical: "Show technical evidence",
  hideTechnical: "Hide technical evidence",
  technicalEvidence: "Technical evidence",
  evidenceSummary: "Evidence summary",
  bothIncreased: "Both recorded metrics increased across the selected window.",
  showAffected: "Show affected metrics",
  hideAffected: "Hide affected metrics",
  generalLimits: "General interpretation limits",
  metricCoverage: "Metric coverage",
  observationCount: "Affected metric observations: {{count}}",
  identityCount: "Distinct metric identities: {{count}}",
  definitionCount: "Equipment definitions with coverage limitations: {{count}}",
  legacyEconomy:
    "Economy metrics are unavailable for one or more selected legacy analyses.",
  domains: {
    industry: "Industry",
    production: "Production allocation",
    stockpile: "Stockpile",
    economy: "Economy",
    other: "Other metrics",
  },
  delta: "Change",
  productionDemand: "Saved resource demand",
  crossedBelow: "Crossed below zero between snapshots:",
  recoveredBetween: "Recovered to zero or above between snapshots:",
  qualityLabel: "Evidence quality",
  confidence: {
    high: "Recorded evidence",
    medium: "Recorded evidence with coverage limitations",
  },
  rawValues: "Exact raw values",
  sourceDetails: "Source details",
  coOccurrence: "Recorded co-occurrence",
  recordedEvidence: "Recorded evidence",
  coverage: "Coverage and interpretation limits",
  unknownQualifier:
    "Additional interpretation limit is not recognized by this interface.",
  algorithm: "Algorithm {{version}}",
  errors: {
    unavailable:
      "The selected snapshots are no longer available for this campaign. Refresh Campaign Trends or choose another window.",
    failed: "Campaign Intelligence could not be loaded. Please try again.",
    invalid:
      "The selected window could not be requested. Choose available campaign snapshots.",
  },
  severity: { informational: "Information", attention: "Attention" },
  basis: {
    persisted_aggregate: "Persisted aggregate",
    serialized_ledger: "Serialized ledger",
  },
  titles: {
    INDUSTRY_ALLOCATION_EXPANSION: "Capacity and allocation",
    INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING:
      "Industrial expansion and resource deficit",
    RESOURCE_PRESSURE_WITH_HIGHER_DEMAND: "Resource balance and demand",
    RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND: "Resource balance recovery",
    ALLOCATION_WITH_STOCKPILE_DECLINE: "Allocation and stockpile decline",
    EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION:
      "Equipment deficit and allocation",
  },
  industryAllocationExpansion:
    "Military capacity and production allocation expanded together.",
  industrialExpansionWithResourceCrossing:
    "Industrial expansion coincided with the recorded {{resource}} balance becoming negative.",
  resourcePressureWithHigherDemand:
    "Higher saved {{resource}} demand accompanied a weaker recorded resource balance.",
  resourceRecoveryWithMaintainedDemand:
    "The recorded {{resource}} balance recovered without lower saved production demand.",
  allocationWithStockpileDecline:
    "More factories were assigned to {{equipment}} while its recorded stockpile balance declined.",
  equipmentDeficitDuringAllocationExpansion:
    "The recorded {{equipment}} stockpile crossed into deficit while production allocation increased.",
  operations: {
    read_projection: "Recorded snapshot value",
    target_minus_base: "Target − Base",
    increase: "Endpoint increase",
    decrease: "Endpoint decrease",
    maintained: "Endpoint value maintained",
    positive_to_negative: "Positive → negative endpoint balance",
    negative_to_nonnegative: "Negative → nonnegative endpoint balance",
    and_endpoint_signals: "Both recorded endpoint signals matched",
  },
  quality: {
    invalid_game_date: "A selected snapshot has an invalid game date.",
    same_date_chronology_unknown:
      "Selected snapshots share a game date. In-day chronology is unknown; temporal insights are suppressed.",
    reversed_temporal_window:
      "The target game date precedes the base. Your selection has not been reordered.",
    game_version_mismatch:
      "Known game versions differ within this window; temporal insights are suppressed.",
    available_authorized_history_only:
      "Only available snapshots in your campaign history are considered.",
    campaign_branch_continuity_not_verified:
      "A shared campaign identity does not prove continuity between campaign branches.",
    same_date_intermediate_order_unknown:
      "Intermediate snapshots share a date; their in-day order is unknown.",
    unplaced_invalid_game_date:
      "A snapshot with an invalid date could not be placed in the window.",
    unknown_game_version: "A snapshot's game version is unknown.",
    metric_legacy: "This metric is unavailable in a legacy analysis.",
    metric_absent: "This metric was not recorded; absence is not zero.",
    metric_invalid: "This metric has an invalid recorded value.",
    metric_unavailable: "This metric is unavailable.",
    serialized_state_at_save_time:
      "Values describe serialized states at save time.",
    intermediate_gaps_endpoint_comparison_only:
      "Intermediate values are missing. This compares endpoints only, not a sustained trend.",
    aggregate_source_coverage_unknown:
      "Aggregate source coverage is not established.",
    industry_aggregate_source_coverage_unknown:
      "Industry aggregate source coverage is not established.",
    allocation_is_not_realized_output:
      "Factory allocation is not realized production output.",
    stockpile_is_recorded_balance_not_requirement:
      "Stockpile is a recorded balance, not an equipment requirement.",
    nominal_saved_demand_not_supplied_quantity:
      "Saved production demand is nominal demand, not currently supplied resources.",
    serialized_state_not_next_runtime_tick:
      "The ledger does not simulate the game's next runtime recalculation.",
  },
};

export const ruIntelligence: typeof enIntelligence = {
  title: "Анализ изменений кампании",
  snapshotCount: "Доступно снимков: {{count}}",
  from: "Начальный снимок",
  to: "Конечный снимок",
  selectSnapshot: "Выберите снимок",
  disclaimer:
    "Выводы основаны на сохранённых состояниях игры и описывают совместно наблюдаемые изменения, а не доказанные причинно-следственные связи.",
  unknownCampaign:
    "Для анализа изменений нужен известный идентификатор кампании. Старые анализы по-прежнему доступны в динамике кампании.",
  insufficientHistory:
    "Нет подходящего периода по умолчанию. Выберите два снимка с разными корректными игровыми датами и совместимыми версиями игры.",
  selectWindow: "Выберите страну, начальный и конечный снимки.",
  loading: "Загрузка анализа изменений…",
  empty: "Для этого периода не обнаружено поддерживаемых сочетаний изменений.",
  incomplete:
    "Часть необходимых показателей отсутствует. В доступных данных не обнаружено поддерживаемых сочетаний изменений; проверить все сочетания невозможно.",
  ineligible:
    "Для этого периода недоступна интерпретация изменений во времени.",
  unsupportedTitle: "Неподдерживаемый вывод",
  unsupportedBody:
    "Эта версия интерфейса не может интерпретировать вывод. Его сохранённые данные по-прежнему доступны.",
  showEvidence: "Показать основания",
  hideEvidence: "Скрыть основания",
  showTechnical: "Показать технические основания",
  hideTechnical: "Скрыть технические основания",
  technicalEvidence: "Технические основания",
  evidenceSummary: "Краткие основания",
  bothIncreased: "Оба сохранённых показателя выросли за выбранный период.",
  showAffected: "Показать затронутые показатели",
  hideAffected: "Скрыть затронутые показатели",
  generalLimits: "Общие ограничения интерпретации",
  metricCoverage: "Полнота показателей",
  observationCount: "Затронуто наблюдений показателей: {{count}}",
  identityCount: "Уникальных показателей: {{count}}",
  definitionCount: "Определений оснащения с ограниченной полнотой: {{count}}",
  legacyEconomy:
    "Показатели экономики недоступны в одном или нескольких выбранных старых анализах.",
  domains: {
    industry: "Промышленность",
    production: "Распределение заводов",
    stockpile: "Запасы",
    economy: "Экономика",
    other: "Другие показатели",
  },
  delta: "Изменение",
  productionDemand: "Сохранённая потребность в ресурсе",
  crossedBelow: "Баланс стал отрицательным между снимками:",
  recoveredBetween: "Баланс восстановился до нуля или выше между снимками:",
  qualityLabel: "Качество оснований",
  confidence: {
    high: "Сохранённые данные",
    medium: "Сохранённые данные с ограничениями полноты",
  },
  rawValues: "Точные исходные значения",
  sourceDetails: "Источник данных",
  coOccurrence: "Совместно наблюдаемые изменения",
  recordedEvidence: "Сохранённые данные",
  coverage: "Полнота данных и ограничения интерпретации",
  unknownQualifier:
    "Дополнительное ограничение интерпретации не распознано этой версией интерфейса.",
  algorithm: "Алгоритм {{version}}",
  errors: {
    unavailable:
      "Выбранные снимки больше недоступны для этой кампании. Обновите динамику кампании или выберите другой период.",
    failed: "Не удалось загрузить анализ изменений. Повторите попытку.",
    invalid:
      "Не удалось запросить выбранный период. Выберите доступные снимки кампании.",
  },
  severity: { informational: "Информация", attention: "Обратите внимание" },
  basis: {
    persisted_aggregate: "Сохранённый агрегат",
    serialized_ledger: "Сохранённый ресурсный баланс",
  },
  titles: {
    INDUSTRY_ALLOCATION_EXPANSION: "Мощности и распределение заводов",
    INDUSTRIAL_EXPANSION_WITH_RESOURCE_CROSSING:
      "Рост промышленности и дефицит ресурса",
    RESOURCE_PRESSURE_WITH_HIGHER_DEMAND: "Ресурсный баланс и потребность",
    RESOURCE_RECOVERY_WITH_MAINTAINED_DEMAND:
      "Восстановление ресурсного баланса",
    ALLOCATION_WITH_STOCKPILE_DECLINE:
      "Распределение заводов и сокращение запасов",
    EQUIPMENT_DEFICIT_DURING_ALLOCATION_EXPANSION:
      "Дефицит оснащения и распределение заводов",
  },
  industryAllocationExpansion:
    "Военные производственные мощности и число выделенных заводов выросли одновременно.",
  industrialExpansionWithResourceCrossing:
    "Рост промышленности совпал с переходом сохранённого баланса ресурса «{{resource}}» в отрицательную область.",
  resourcePressureWithHigherDemand:
    "Рост сохранённой потребности в ресурсе «{{resource}}» сопровождался ухудшением его сохранённого баланса.",
  resourceRecoveryWithMaintainedDemand:
    "Сохранённый баланс ресурса «{{resource}}» восстановился без снижения сохранённой производственной потребности.",
  allocationWithStockpileDecline:
    "Для «{{equipment}}» выделено больше заводов, а сохранённый баланс запасов снизился.",
  equipmentDeficitDuringAllocationExpansion:
    "Сохранённый баланс запасов «{{equipment}}» стал дефицитным одновременно с ростом числа выделенных заводов.",
  operations: {
    read_projection: "Сохранённое значение снимка",
    target_minus_base: "Конечное − начальное",
    increase: "Рост между крайними снимками",
    decrease: "Снижение между крайними снимками",
    maintained: "Значение крайних снимков не изменилось",
    positive_to_negative:
      "Положительный → отрицательный баланс крайних снимков",
    negative_to_nonnegative:
      "Отрицательный → неотрицательный баланс крайних снимков",
    and_endpoint_signals: "Совпали оба изменения между крайними снимками",
  },
  quality: {
    invalid_game_date: "Игровая дата одного из выбранных снимков некорректна.",
    same_date_chronology_unknown:
      "У выбранных снимков одна игровая дата. Порядок внутри дня неизвестен; выводы об изменениях во времени не формируются.",
    reversed_temporal_window:
      "Игровая дата конечного снимка раньше начального. Ваш выбор не был переставлен.",
    game_version_mismatch:
      "Известные версии игры в этом периоде различаются; выводы об изменениях во времени не формируются.",
    available_authorized_history_only:
      "Учитываются только доступные снимки в вашей истории кампании.",
    campaign_branch_continuity_not_verified:
      "Общий идентификатор кампании не доказывает непрерывность между её ветками.",
    same_date_intermediate_order_unknown:
      "У промежуточных снимков одна дата; их порядок внутри дня неизвестен.",
    unplaced_invalid_game_date:
      "Снимок с некорректной датой не удалось разместить в периоде.",
    unknown_game_version: "Версия игры одного из снимков неизвестна.",
    metric_legacy: "Этот показатель недоступен в старом анализе.",
    metric_absent: "Показатель не записан; отсутствие не означает ноль.",
    metric_invalid: "Сохранённое значение показателя некорректно.",
    metric_unavailable: "Показатель недоступен.",
    serialized_state_at_save_time:
      "Значения описывают записанные в файлах состояния на момент сохранения.",
    intermediate_gaps_endpoint_comparison_only:
      "Промежуточные значения отсутствуют. Сравниваются только крайние снимки, а не устойчивая динамика.",
    aggregate_source_coverage_unknown:
      "Полнота источников агрегата не установлена.",
    industry_aggregate_source_coverage_unknown:
      "Полнота источников промышленного агрегата не установлена.",
    allocation_is_not_realized_output:
      "Распределение заводов не равно фактическому выпуску продукции.",
    stockpile_is_recorded_balance_not_requirement:
      "Запасы — сохранённый баланс, а не потребность в оснащении.",
    nominal_saved_demand_not_supplied_quantity:
      "Сохранённая производственная потребность номинальна и не равна текущему снабжению ресурсами.",
    serialized_state_not_next_runtime_tick:
      "Баланс не моделирует следующий пересчёт во время работы игры.",
  },
};
