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

const keyUnordered = (w: ParsedWarCasualties) => {
  const a = w.firstTag || '';
  const b = w.secondTag || '';
  return [a, b].sort().join(':::') + ':::' + (w.startDate || '');
};

const groups = new Map<string, ParsedWarCasualties[]>();
for (const w of wars) {
  const k = keyUnordered(w);
  const arr = groups.get(k) || [];
  arr.push(w);
  groups.set(k, arr);
}

let mirrorGroups = 0;
for (const [k, arr] of groups.entries()) {
  if (arr.length > 1) {
    // check if at least two entries are not identical and have swapped tags
    const pairs: [ParsedWarCasualties, ParsedWarCasualties][] = [];
    for (let i = 0; i < arr.length; i++)
      for (let j = i + 1; j < arr.length; j++) pairs.push([arr[i], arr[j]]);
    for (const [a, b] of pairs) {
      // consider mirror if firstTag of a == secondTag of b and vice versa
      if (a.firstTag === b.secondTag && a.secondTag === b.firstTag) {
        mirrorGroups++;
        console.log('--- Mirror pair ---');
        console.log('A=', JSON.stringify(a, null, 2));
        console.log('B=', JSON.stringify(b, null, 2));
        // show differing fields
        const diffs: string[] = [];
        const fields: (keyof ParsedWarCasualties)[] = [
          'firstCasualties',
          'secondCasualties',
          'parentTag',
          'sourceOffset',
          'wargoalIds',
          'startDate',
        ];
        for (const f of fields) {
          const va = JSON.stringify((a as any)[f]);
          const vb = JSON.stringify((b as any)[f]);
          if (va !== vb) diffs.push(`${f}: A=${va} B=${vb}`);
        }
        if (diffs.length) console.log('Diffs:\n', diffs.join('\n'));
      }
    }
  }
}

console.log('Mirror groups found:', mirrorGroups);
