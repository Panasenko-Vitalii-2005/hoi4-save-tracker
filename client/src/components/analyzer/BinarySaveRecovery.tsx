import { useAppTranslation } from "@/i18n";

export function BinarySaveRecovery({
  onChooseFile,
}: {
  onChooseFile: () => void;
}) {
  const { t } = useAppTranslation();
  return (
    <section
      className="binary-save-recovery"
      aria-labelledby="binary-save-recovery-title"
    >
      <div className="binary-save-recovery-intro">
        <span className="batch-analysis-eyebrow">{t("binary.eyebrow")}</span>
        <h2 id="binary-save-recovery-title">
          {t("binary.title")}
        </h2>
        <p>
          {t("binary.intro")}
        </p>
      </div>

      <details className="binary-save-recovery-steps">
        <summary>{t("binary.steps")}</summary>
        <div className="binary-save-recovery-body">
          <ol>
            <li>{t("binary.closeGame")}</li>
            <li>
              {t("binary.openSettings")}
            </li>
            <li>
              {t("binary.findSetting")}
            </li>
            <li>
              {t("binary.changeSetting")}
            </li>
            <li>{t("binary.startGame")}</li>
            <li>{t("binary.loadSave")}</li>
            <li>{t("binary.saveAgain")}</li>
            <li>{t("binary.uploadNew")}</li>
          </ol>

          <div className="binary-save-recovery-location">
            <h3>{t("binary.location")}</h3>
            <p>{t("binary.locationBody")}</p>
            <code>
              {"%USERPROFILE%\\Documents\\Paradox Interactive\\Hearts of Iron IV\\settings.txt"}
            </code>
            <p>
              {t("binary.oneDrive")}
            </p>
          </div>

          <p className="binary-save-recovery-note">
            <strong>{t("binary.oldFileTitle")}</strong>{t("binary.oldFileBody")}
          </p>
          <p className="binary-save-recovery-note">
            <strong>{t("binary.oneTimeTitle")}</strong>{t("binary.oneTimeBody")}
          </p>
        </div>
      </details>

      <button
        type="button"
        className="button button-secondary analyzer-status-action"
        onClick={onChooseFile}
      >
        {t("binary.choose")}
      </button>
    </section>
  );
}
