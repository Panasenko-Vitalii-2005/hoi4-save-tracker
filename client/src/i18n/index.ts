import i18n from "i18next";
import { initReactI18next, useTranslation } from "react-i18next";
import { en } from "./en";
import { ru } from "./ru";

export const LANGUAGE_STORAGE_KEY = "hoi4-language";
export const SUPPORTED_LANGUAGES = ["en", "ru"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

function storedLanguage(): AppLanguage | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return stored === "en" || stored === "ru" ? stored : null;
  } catch {
    return null;
  }
}

function initialLanguage(): AppLanguage {
  const stored = storedLanguage();
  if (stored) return stored;
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("ru")
    ? "ru"
    : "en";
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ru: { translation: ru } },
    lng: initialLanguage(),
    fallbackLng: "en",
    supportedLngs: [...SUPPORTED_LANGUAGES],
    interpolation: { escapeValue: false },
    returnNull: false,
  });
}

function syncDocumentLanguage(language: string): void {
  const resolved = language.startsWith("ru") ? "ru" : "en";
  document.documentElement.lang = resolved;
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, resolved);
  } catch {
    // Language persistence is optional when storage is unavailable.
  }
}

syncDocumentLanguage(i18n.resolvedLanguage ?? i18n.language);
i18n.on("languageChanged", syncDocumentLanguage);

export const useAppTranslation = useTranslation;

export function appLocale(language = i18n.resolvedLanguage ?? i18n.language): string {
  return language.startsWith("ru") ? "ru-RU" : "en-US";
}

export { i18n };
