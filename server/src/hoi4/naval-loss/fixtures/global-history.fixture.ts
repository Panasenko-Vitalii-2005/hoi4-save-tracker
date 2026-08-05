export const COMPLETE_SUNK_SHIP = `sunk_ship={
  name="U-144"
  killer_name="HMS Napier"
  country="GER"
  killer_country="ENG"
  level=3
  definition=submarine
  killer_definition=destroyer
  location=8522
  date="1943.9.28.21"
  equipment_variant={ id=6032 type=70 }
  battle={ id=124995 type=4713 }
  convoy=no
}`;

export function topLevelHistory(...entries: string[]): string {
  return `history={
${entries.join('\n')}
}`;
}

export function sunkShipWith(
  replacements: Record<string, string | null>,
): string {
  const lines = COMPLETE_SUNK_SHIP.split('\n');
  return lines
    .filter((line) => {
      const key = line.trim().split('=')[0];
      return replacements[key] !== null;
    })
    .map((line) => {
      const key = line.trim().split('=')[0];
      if (!(key in replacements)) return line;
      return `  ${key}=${replacements[key]}`;
    })
    .join('\n');
}
