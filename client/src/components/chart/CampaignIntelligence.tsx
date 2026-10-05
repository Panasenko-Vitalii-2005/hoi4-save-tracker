import { useEffect, useId, useMemo, useState } from "react";
import type { CampaignTrend } from "@/types/campaign-trends";
import type {
  CampaignIntelligenceDto,
  Evidence,
  Insight,
  MetricKey,
} from "@/types/campaign-intelligence";
import { apiFetch } from "@/lib/api-client";
import {
  countryFullName,
  formatEquipmentDefinition,
  formatHoi4Date,
} from "@/lib/utils";
import { rawEconomyValue } from "@/lib/economy-display";
import { useAppTranslation } from "@/i18n";
import {
  defaultIntelligenceWindow,
  intelligenceDay,
  isCampaignIntelligenceDto,
  METRIC_LABELS,
  supportedInsight,
} from "@/lib/campaign-intelligence";
import "./CampaignIntelligence.css";

function Snapshot({
  hash,
  campaign,
}: {
  hash: string;
  campaign: CampaignTrend;
}) {
  const { t } = useAppTranslation();
  const snapshot = campaign.snapshots.find((s) => s.hash === hash);
  return (
    <span className="intelligence-snapshot">
      {snapshot && intelligenceDay(snapshot.gameDate) !== null
        ? formatHoi4Date(`${snapshot.gameDate}.0`)
        : t("common.unknown")}
      {" · "}
      <code title={hash}>{hash.slice(0, 8)}</code>
    </span>
  );
}

function Metric({ metric }: { metric: MetricKey }) {
  const { t } = useAppTranslation();
  return (
    <span>
      {t(METRIC_LABELS[metric.id])}
      {metric.resource && <> · {t(`economy.resources.${metric.resource}`)}</>}
      {metric.equipmentDefinition && (
        <>
          {" · "}
          {formatEquipmentDefinition(metric.equipmentDefinition)}
          <code className="intelligence-definition">
            {metric.equipmentDefinition}
          </code>
        </>
      )}
    </span>
  );
}

function Qualifiers({ codes }: { codes: string[] }) {
  const { t, i18n } = useAppTranslation();
  return (
    <ul>
      {[...new Set(codes)].map((code) => (
        <li key={code}>
          {i18n.exists(`intelligence.quality.${code}`)
            ? t(`intelligence.quality.${code}`)
            : t("intelligence.unknownQualifier")}
        </li>
      ))}
    </ul>
  );
}

function EvidenceRecord({
  entry,
  campaign,
}: {
  entry: Evidence;
  campaign: CampaignTrend;
}) {
  const { t, i18n } = useAppTranslation();
  const operationKey = `intelligence.operations.${entry.operation}`;
  return (
    <li className="intelligence-evidence-record">
      <strong>
        {entry.metric ? (
          <Metric metric={entry.metric} />
        ) : (
          t("intelligence.coOccurrence")
        )}
      </strong>
      <div>
        {i18n.exists(operationKey)
          ? t(operationKey)
          : t("intelligence.recordedEvidence")}
      </div>
      <div className="intelligence-raw">
        {t("intelligence.rawValues")}:{" "}
        {entry.rawValues.map(rawEconomyValue).join(" → ")}
      </div>
      {entry.missingReason && (
        <div>{t(`intelligence.quality.metric_${entry.missingReason}`)}</div>
      )}
      <ul className="intelligence-sources">
        {entry.sources.map((source, index) => (
          <li key={`${source.snapshotHash}-${source.resultPath}-${index}`}>
            <Snapshot hash={source.snapshotHash} campaign={campaign} />
            <span> · {t(`intelligence.basis.${source.basis}`)}</span>
            <details>
              <summary>{t("intelligence.sourceDetails")}</summary>
              <code>{source.snapshotHash}</code>
              <code>{source.resultPath}</code>
            </details>
          </li>
        ))}
      </ul>
    </li>
  );
}

export function IntelligenceCard({
  insight,
  data,
  campaign,
}: {
  insight: Insight;
  data: CampaignIntelligenceDto;
  campaign: CampaignTrend;
}) {
  const { t } = useAppTranslation();
  const [expanded, setExpanded] = useState(false);
  const evidenceId = useId();
  const supported = supportedInsight(insight);
  const signals = supported
    ? insight.signalIds.flatMap((id) =>
        data.signals.filter((signal) => signal.id === id),
      )
    : [];
  const evidenceIds = new Set(insight.evidenceIds);
  // Include input facts, retaining backend order rather than inventing a presentation ranking.
  const byId = new Map(data.evidence.map((entry) => [entry.id, entry]));
  const visit = (id: string) => {
    for (const input of byId.get(id)?.inputEvidenceIds ?? []) {
      if (!evidenceIds.has(input)) {
        evidenceIds.add(input);
        visit(input);
      }
    }
  };
  insight.evidenceIds.forEach(visit);
  const evidence = data.evidence.filter((entry) => evidenceIds.has(entry.id));
  const params = {
    ...insight.messageParams,
    ...(typeof insight.messageParams.resource === "string"
      ? { resource: t(`economy.resources.${insight.messageParams.resource}`) }
      : {}),
    ...(typeof insight.messageParams.equipmentDefinition === "string"
      ? {
          equipment: formatEquipmentDefinition(
            insight.messageParams.equipmentDefinition,
          ),
        }
      : {}),
  };
  return (
    <article className="intelligence-card" data-catalog-id={insight.catalogId}>
      <span className={`intelligence-severity ${insight.severity}`}>
        {t(`intelligence.severity.${insight.severity}`)}
      </span>
      <h3>
        {supported
          ? t(`intelligence.titles.${insight.catalogId}`)
          : t("intelligence.unsupportedTitle")}
      </h3>
      <p>
        {supported
          ? t(insight.messageKey, params)
          : t("intelligence.unsupportedBody")}
      </p>
      <dl className="intelligence-facts">
        {signals.slice(0, 3).map((signal) => (
          <div key={signal.id}>
            <dt>
              <Metric metric={signal.metric} />
            </dt>
            <dd>
              <span>
                {rawEconomyValue(signal.summary.startValue)} →{" "}
                {rawEconomyValue(signal.summary.endValue)}
              </span>
              <span>
                {t("intelligence.delta")}:{" "}
                {rawEconomyValue(signal.summary.delta)}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {signals
        .filter((signal) => signal.crossingBracket)
        .map((signal) => (
          <p key={signal.id} className="intelligence-crossing">
            {t(
              signal.type === "positive_to_negative"
                ? "intelligence.crossedBelow"
                : "intelligence.recoveredBetween",
            )}{" "}
            <Snapshot
              hash={signal.crossingBracket!.beforeHash}
              campaign={campaign}
            />
            {" → "}
            <Snapshot
              hash={signal.crossingBracket!.afterHash}
              campaign={campaign}
            />
          </p>
        ))}
      <button
        type="button"
        className="button button-secondary"
        aria-expanded={expanded}
        aria-controls={evidenceId}
        onClick={() => setExpanded((value) => !value)}
      >
        {t(
          expanded ? "intelligence.hideEvidence" : "intelligence.showEvidence",
        )}
      </button>
      {expanded && (
        <div id={evidenceId} className="intelligence-evidence">
          <p>
            {t("intelligence.qualityLabel")}:{" "}
            {t(`intelligence.confidence.${insight.confidence.level}`)}
          </p>
          <Qualifiers
            codes={[
              ...insight.qualifiers,
              ...insight.confidence.reasons,
              ...evidence.flatMap((entry) => entry.qualifiers),
            ]}
          />
          <ol>
            {evidence.map((entry) => (
              <EvidenceRecord
                key={entry.id}
                entry={entry}
                campaign={campaign}
              />
            ))}
          </ol>
        </div>
      )}
    </article>
  );
}

export function CampaignIntelligence({
  campaign,
  countryTag,
}: {
  campaign: CampaignTrend;
  countryTag: string;
}) {
  const { t } = useAppTranslation();
  const id = useId();
  const defaults = useMemo(
    () => defaultIntelligenceWindow(campaign),
    [campaign],
  );
  const [selection, setSelection] = useState({
    campaignKey: campaign.key,
    ...defaults,
  });
  const current =
    selection.campaignKey === campaign.key
      ? selection
      : { campaignKey: campaign.key, ...defaults };
  const { baseHash, targetHash } = current;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: CampaignIntelligenceDto;
    error?: "unavailable" | "failed" | "invalid";
  } | null>(null);
  const knownCampaign =
    campaign.relationship === "known" &&
    /^campaign:[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      campaign.key,
    );
  const available = (hash: string) =>
    /^[a-f0-9]{64}$/.test(hash) &&
    campaign.snapshots.some((s) => s.hash === hash);
  const ready =
    knownCampaign &&
    /^[A-Z][A-Z0-9]{2}$/.test(countryTag) &&
    campaign.snapshots.some((snapshot) =>
      snapshot.countries.some((country) => country.tag === countryTag),
    ) &&
    available(baseHash) &&
    available(targetHash);
  const requestKey = JSON.stringify([
    campaign.key,
    countryTag,
    baseHash,
    targetHash,
    revision,
  ]);
  const active = ready && result?.key === requestKey ? result : null;
  const data = active?.data;

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    setResult(null);
    void (async () => {
      try {
        const query = new URLSearchParams({
          campaignKey: campaign.key,
          countryTag,
          baseHash,
          targetHash,
        });
        const response = await apiFetch(`/api/analyze/intelligence?${query}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setResult({
            key: requestKey,
            error:
              response.status === 404
                ? "unavailable"
                : response.status === 400
                  ? "invalid"
                  : "failed",
          });
          return;
        }
        const body: unknown = await response.json();
        if (controller.signal.aborted) return;
        if (
          !isCampaignIntelligenceDto(body) ||
          body.window.campaignKey !== campaign.key ||
          body.window.countryTag !== countryTag ||
          body.window.baseHash !== baseHash ||
          body.window.targetHash !== targetHash
        )
          throw new Error("Invalid intelligence response");
        setResult({ key: requestKey, data: body });
      } catch {
        if (!controller.signal.aborted)
          setResult({ key: requestKey, error: "failed" });
      }
    })();
    return () => controller.abort();
  }, [campaign, countryTag, baseHash, targetHash, ready, requestKey]);

  const setEndpoint = (endpoint: "baseHash" | "targetHash", hash: string) =>
    setSelection({ ...current, [endpoint]: hash });
  const incomplete = data?.summaries.some(
    (summary) => summary.startValue === null || summary.endValue === null,
  );
  return (
    <section
      className="panel campaign-intelligence"
      aria-labelledby={`${id}-title`}
    >
      <div className="campaign-section-heading">
        <div>
          <h2 id={`${id}-title`}>{t("intelligence.title")}</h2>
          <p>
            {countryTag
              ? countryFullName(countryTag)
              : t("common.selectCountry")}{" "}
            ·{" "}
            {t("intelligence.snapshotCount", {
              count: campaign.snapshots.length,
            })}
          </p>
        </div>
      </div>
      <p className="intelligence-note">{t("intelligence.disclaimer")}</p>
      <div className="intelligence-window">
        {(["baseHash", "targetHash"] as const).map((endpoint) => (
          <label className="field compact-field" key={endpoint}>
            <span>
              {t(
                endpoint === "baseHash"
                  ? "intelligence.from"
                  : "intelligence.to",
              )}
            </span>
            <select
              value={current[endpoint]}
              onChange={(event) => setEndpoint(endpoint, event.target.value)}
              disabled={!knownCampaign}
            >
              <option value="">{t("intelligence.selectSnapshot")}</option>
              {campaign.snapshots.map((snapshot) => (
                <option key={snapshot.hash} value={snapshot.hash}>
                  {intelligenceDay(snapshot.gameDate) !== null
                    ? formatHoi4Date(`${snapshot.gameDate}.0`)
                    : t("common.unknown")}{" "}
                  · {snapshot.fileName} · {snapshot.hash.slice(0, 8)}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      {!knownCampaign ? (
        <p role="status">{t("intelligence.unknownCampaign")}</p>
      ) : !ready ? (
        <p role="status">
          {t(
            defaults.baseHash
              ? "intelligence.selectWindow"
              : "intelligence.insufficientHistory",
          )}
        </p>
      ) : !active ? (
        <p role="status">{t("intelligence.loading")}</p>
      ) : active.error ? (
        <div role="alert">
          <p>{t(`intelligence.errors.${active.error}`)}</p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setRevision((value) => value + 1)}
          >
            {t("common.retry")}
          </button>
        </div>
      ) : (
        data && (
          <>
            {!data.window.temporalEligible ? (
              <div role="status" className="intelligence-suppressed">
                <strong>{t("intelligence.ineligible")}</strong>
                <Qualifiers codes={data.window.suppressionReasons} />
              </div>
            ) : !data.insights.length ? (
              <p role="status">
                {t(
                  incomplete ? "intelligence.incomplete" : "intelligence.empty",
                )}
              </p>
            ) : (
              <div className="intelligence-cards">
                {data.insights.map((insight) => (
                  <IntelligenceCard
                    key={insight.id}
                    insight={insight}
                    data={data}
                    campaign={campaign}
                  />
                ))}
              </div>
            )}
            {!!data.coverageIssues.length && (
              <details className="intelligence-coverage">
                <summary>{t("intelligence.coverage")}</summary>
                <ul>
                  {data.coverageIssues.map((issue, index) => (
                    <li key={index}>
                      <Qualifiers codes={[issue.code]} />
                      {issue.metric && <Metric metric={issue.metric} />}
                      {issue.snapshotHash && (
                        <>
                          {" "}
                          ·{" "}
                          <Snapshot
                            hash={issue.snapshotHash}
                            campaign={campaign}
                          />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <small className="intelligence-version">
              {t("intelligence.algorithm", { version: data.algorithmVersion })}
            </small>
          </>
        )
      )}
    </section>
  );
}
