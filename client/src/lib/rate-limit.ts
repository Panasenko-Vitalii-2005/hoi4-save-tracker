import { i18n } from "@/i18n";

/** Only bounded numeric retry guidance is trusted, never server error text. */
export function rateLimitMessage(response: Response): string {
  const value = response.headers.get("Retry-After");
  const seconds = value && /^\d+$/.test(value) ? Number(value) : 0;
  return Number.isSafeInteger(seconds) && seconds > 0 && seconds <= 3600
    ? i18n.t("common.rateLimitedWait", { seconds })
    : i18n.t("common.rateLimited");
}
