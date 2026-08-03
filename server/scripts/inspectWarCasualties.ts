import { analyzeSave, ParsedWarCasualties } from '../src/hoi4/hoi4-parser';
import * as path from 'path';

const save = path.resolve(__dirname, '../../saves/autosave_100_temp.hoi4');
const res = analyzeSave(save);
const wars = (res as any).warCasualties || [];

const key = (w: ParsedWarCasualties) =>
  `${w.firstTag || ''}:::${w.secondTag || ''}:::${w.startDate || ''}`;
const groups = new Map<string, ParsedWarCasualties[]>();
for (const w of wars as ParsedWarCasualties[]) {
  const k = key(w);
  const arr = groups.get(k) || [];
  arr.push(w);
  groups.set(k, arr);
}

let exactDupeCount = 0;
for (const arr of groups.values()) {
  const seen = new Map<string, number>();
  for (const e of arr) {
    const s = JSON.stringify(e);
    seen.set(s, (seen.get(s) || 0) + 1);
  }
  for (const c of seen.values()) if (c > 1) exactDupeCount += c - 1;
}

const tagToKeys = new Map<string, Set<string>>();
for (const [k, arr] of groups.entries()) {
  const w = arr[0];
  if (w.firstTag) {
    const set = tagToKeys.get(w.firstTag) || new Set<string>();
    set.add(k);
    tagToKeys.set(w.firstTag, set);
  }
  if (w.secondTag) {
    const set = tagToKeys.get(w.secondTag) || new Set<string>();
    set.add(k);
    tagToKeys.set(w.secondTag, set);
  }
}

let tagsMulti = 0;
for (const set of tagToKeys.values()) {
  if (set.size > 1) tagsMulti++;
}

console.log(
  JSON.stringify(
    {
      total: wars.length,
      unique: groups.size,
      exactDupeCount,
      tagsMulti,
      first10: wars.slice(0, 10),
    },
    null,
    2,
  ),
);
