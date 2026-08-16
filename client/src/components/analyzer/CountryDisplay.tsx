import { memo } from "react";
import { getCountryDisplayName } from "@/lib/countryNames";

interface Props {
  tag: string | null | undefined;
  unknownLabel?: string;
}

export const CountryDisplay = memo(function CountryDisplay({
  tag,
  unknownLabel = "Unknown country",
}: Props) {
  if (!tag) return <span className="country-display">{unknownLabel}</span>;

  const displayName = getCountryDisplayName(tag);
  return (
    <span className="country-display">
      <span className="country-display-name">{displayName}</span>
      {displayName !== tag && (
        <span className="country-display-tag">{tag}</span>
      )}
    </span>
  );
});
