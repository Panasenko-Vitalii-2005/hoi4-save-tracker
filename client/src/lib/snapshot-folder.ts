export type SnapshotSampleTarget = 10 | 25 | 50 | "all";

const SNAPSHOT_FILE_PATTERN =
  /^.+_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:_\d+)?\.hoi4$/i;

export function parseSnapshotTimestamp(fileName: string): number | null {
  const match = SNAPSHOT_FILE_PATTERN.exec(fileName);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(timestamp);

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  ) {
    return null;
  }

  return timestamp;
}

function isDirectFolderFile(file: File): boolean {
  const relativePath = file.webkitRelativePath;
  if (!relativePath) return true;

  const pathParts = relativePath.split(/[\\/]/).filter(Boolean);
  return pathParts.length <= 2;
}

export function filterSnapshotFolderFiles(files: readonly File[]): File[] {
  return files.filter(
    (file) =>
      !file.name.startsWith(".") &&
      file.name.toLowerCase().endsWith(".hoi4") &&
      isDirectFolderFile(file),
  );
}

export function sortSnapshotFiles(files: readonly File[]): File[] {
  return files
    .map((file, sourceIndex) => ({
      file,
      sourceIndex,
      timestamp: parseSnapshotTimestamp(file.name),
    }))
    .sort((left, right) => {
      const leftTime = left.timestamp ?? left.file.lastModified;
      const rightTime = right.timestamp ?? right.file.lastModified;

      return (
        leftTime - rightTime ||
        left.file.name.localeCompare(right.file.name, "en") ||
        left.sourceIndex - right.sourceIndex
      );
    })
    .map(({ file }) => file);
}

export function sampleSnapshotFiles<T>(
  orderedFiles: readonly T[],
  target: SnapshotSampleTarget,
): T[] {
  if (target === "all" || orderedFiles.length <= target) {
    return [...orderedFiles];
  }

  if (target <= 1) {
    return orderedFiles.length === 0 ? [] : [orderedFiles[0]];
  }

  const selectedIndexes = new Set<number>();
  for (let index = 0; index < target; index += 1) {
    selectedIndexes.add(
      Math.round((index * (orderedFiles.length - 1)) / (target - 1)),
    );
  }

  // The formula is unique for target <= file count, but retain a deterministic
  // fill path so future sample sizes cannot silently return fewer files.
  if (selectedIndexes.size < target) {
    for (let index = 0; index < orderedFiles.length; index += 1) {
      selectedIndexes.add(index);
      if (selectedIndexes.size === target) break;
    }
  }

  return [...selectedIndexes]
    .sort((left, right) => left - right)
    .map((index) => orderedFiles[index]);
}

export function totalFileSize(files: readonly File[]): number {
  return files.reduce((total, file) => total + file.size, 0);
}

export function formatFileSize(value: number, locale: string): string {
  if (value < 1024) return `${value} B`;

  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unitIndex = -1;
  do {
    amount /= 1024;
    unitIndex += 1;
  } while (amount >= 1024 && unitIndex < units.length - 1);

  return `${new Intl.NumberFormat(locale, {
    maximumFractionDigits: amount >= 100 ? 0 : 1,
  }).format(amount)} ${units[unitIndex]}`;
}
