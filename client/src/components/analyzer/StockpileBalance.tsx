import { formatStockpileAmount } from "@/lib/utils";
import { useAppTranslation } from "@/i18n";

export function StockpileBalance({ amount }: { amount: number }) {
  const { t } = useAppTranslation();
  return amount < 0 ? (
    <span className="stockpile-deficit">
      {t("stockpile.deficit", { amount: formatStockpileAmount(-amount) })}
    </span>
  ) : (
    <>{formatStockpileAmount(amount)}</>
  );
}
