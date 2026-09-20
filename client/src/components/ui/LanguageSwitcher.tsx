import { i18n, useAppTranslation, type AppLanguage } from "@/i18n";

export function LanguageSwitcher() {
  const { t } = useAppTranslation();
  const language: AppLanguage = i18n.resolvedLanguage === "ru" ? "ru" : "en";

  return (
    <label className="language-switcher">
      <span className="sr-only">{t("common.language")}</span>
      <select
        aria-label={t("common.language")}
        value={language}
        onChange={(event) => void i18n.changeLanguage(event.target.value)}
      >
        <option value="en">EN</option>
        <option value="ru">RU</option>
      </select>
    </label>
  );
}
