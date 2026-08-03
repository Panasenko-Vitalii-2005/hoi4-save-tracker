const { analyzeSave } = require('./dist/hoi4/hoi4-parser');
const path = require('path');

const save = path.resolve(__dirname, '../saves/autosave_100_temp.hoi4');
const res = analyzeSave(save);
const wars = res.warCasualties || [];

const key = (w) =>
  `${w.firstTag || ''}:::${w.secondTag || ''}:::${w.startDate || ''}`;
const groups = new Map();
for (const w of wars) {
  const k = key(w);
  const arr = groups.get(k) || [];
  arr.push(w);
  groups.set(k, arr);
}

let exactDupeCount = 0;
for (const arr of groups.values()) {
  const seen = new Map();
  for (const e of arr) {
    const s = JSON.stringify(e);
    seen.set(s, (seen.get(s) || 0) + 1);
  }
  for (const c of seen.values()) if (c > 1) exactDupeCount += c - 1;
}

const tagToKeys = new Map();
for (const [k, arr] of groups.entries()) {
  const w = arr[0];
  if (w.firstTag) {
    const set = tagToKeys.get(w.firstTag) || new Set();
    set.add(k);
    tagToKeys.set(w.firstTag, set);
  }
  if (w.secondTag) {
    const set = tagToKeys.get(w.secondTag) || new Set();
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
