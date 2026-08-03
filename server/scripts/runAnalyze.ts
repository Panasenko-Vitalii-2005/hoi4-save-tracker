import { analyzeSave, ParsedWarCasualties } from '../src/hoi4/hoi4-parser';
import * as fs from 'fs';
import * as path from 'path';

const savePath = path.resolve(__dirname, '../../saves/autosave_100_temp.hoi4');
if (!fs.existsSync(savePath)) {
  console.error('Save not found:', savePath);
  process.exit(2);
}

const res = analyzeSave(savePath as any);
const wars: ParsedWarCasualties[] = (res as any).warCasualties || [];

console.log('Total warCasualties entries:', wars.length);

// unique by first+second+startDate
const key = (w: ParsedWarCasualties) =>
  `${w.firstTag || ''}:::${w.secondTag || ''}:::${w.startDate || ''}`;
const uniqueMap = new Map<string, ParsedWarCasualties[]>();
for (const w of wars) {
  const k = key(w);
  const arr = uniqueMap.get(k) || [];
  arr.push(w);
  uniqueMap.set(k, arr);
}

let exactDupeCount = 0;
for (const [k, arr] of uniqueMap.entries()) {
  // exact duplicates defined as identical JSON
  const seen = new Map<string, number>();
  for (const e of arr) {
    const s = JSON.stringify(e);
    seen.set(s, (seen.get(s) || 0) + 1);
  }
  for (const c of seen.values()) if (c > 1) exactDupeCount += c - 1;
}

// tags participating in >1 unique war
const tagToKeys = new Map<string, Set<string>>();
for (const [k, arr] of uniqueMap.entries()) {
  const w = arr[0];
  if (w.firstTag)
    (
      tagToKeys.get(w.firstTag) ||
      tagToKeys.set(w.firstTag, new Set()).get(w.firstTag)!
    ).add(k);
  if (w.secondTag)
    (
      tagToKeys.get(w.secondTag) ||
      tagToKeys.set(w.secondTag, new Set()).get(w.secondTag)!
    ).add(k);
}
let tagsMulti = 0;
for (const [tag, set] of tagToKeys.entries()) if (set.size > 1) tagsMulti++;

console.log('Unique first+second+startDate combinations:', uniqueMap.size);
console.log('Exact duplicate entries (identical JSON):', exactDupeCount);
console.log('Tags participating in >1 unique war:', tagsMulti);

console.log('\nFirst 10 warCasualties entries:');
console.log(JSON.stringify(wars.slice(0, 10), null, 2));

// Show some duplicates examples: show keys with more than 1 entry
console.log('\nDuplicate groups (by first+second+startDate) with count>1:');
for (const [k, arr] of uniqueMap.entries()) {
  if (arr.length > 1) {
    console.log('---');
    console.log('key=', k, 'count=', arr.length);
    for (const a of arr) console.log(JSON.stringify(a));
  }
}
