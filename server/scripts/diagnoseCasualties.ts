import { analyzeSave, ParsedWarCasualties } from '../src/hoi4/hoi4-parser';
import * as fs from 'fs';
import * as path from 'path';

const save = path.resolve(__dirname, '../../saves/autosave_100_temp.hoi4');
const res = analyzeSave(save);
const wars = (res as any).warCasualties || ([] as ParsedWarCasualties[]);

const byTag = new Map<
  string,
  {
    first: number;
    second: number;
    combined: number;
    count: number;
    entries: ParsedWarCasualties[];
  }
>();
for (const w of wars) {
  const add = (
    tag: string | null,
    value: number | null,
    role: 'first' | 'second',
  ) => {
    if (!tag || value == null) return;
    const existing = byTag.get(tag) || {
      first: 0,
      second: 0,
      combined: 0,
      count: 0,
      entries: [] as ParsedWarCasualties[],
    };
    if (role === 'first') existing.first += value;
    else existing.second += value;
    existing.combined += value;
    existing.count += 1;
    existing.entries.push(w);
    byTag.set(tag, existing);
  };
  add(w.firstTag, w.firstCasualties, 'first');
  add(w.secondTag, w.secondCasualties, 'second');
}

const sorted = Array.from(byTag.entries())
  .sort((a, b) => b[1].combined - a[1].combined)
  .slice(0, 20);
console.log('TOP20_BY_COMBINED');
for (const [tag, stat] of sorted) {
  console.log(
    `${tag}\tcount=${stat.count}\tfirst=${stat.first}\tsecond=${stat.second}\tcombined=${stat.combined}`,
  );
}

const targetTags = ['GER', 'ENG', 'SOV', 'JAP', 'ITA'];
for (const tag of targetTags) {
  const entries = (byTag.get(tag)?.entries || []).slice();
  if (!entries.length) continue;
  console.log(`\n=== ${tag} ===`);
  for (const e of entries) {
    const role = e.firstTag === tag ? 'first' : 'second';
    const value = role === 'first' ? e.firstCasualties : e.secondCasualties;
    console.log(
      `${tag}\t${role}\t${e.secondTag || e.firstTag}\t${e.startDate}\t${value}`,
    );
  }
}

// Compare with mp_losses[0] for two countries using the save file content directly.
const content = fs.readFileSync(save, 'latin1');
const mpLossMatches = [...content.matchAll(/mp_losses\s*=\s*\{([^}]*)\}/g)];
const mpByTag = new Map<string, number>();
for (const m of mpLossMatches) {
  const block = m[1];
  const entries = [
    ...block.matchAll(
      /value\s*=\s*\{\s*tag\s*=\s*"([A-Z][A-Z0-9]{2})"\s*value\s*=\s*(\d+)/g,
    ),
  ];
  for (const e of entries) {
    const tag = e[1];
    const val = parseInt(e[2], 10);
    mpByTag.set(tag, (mpByTag.get(tag) || 0) + val);
  }
}

for (const tag of ['GER', 'SOV']) {
  const war = byTag.get(tag)?.combined || 0;
  const mp0 = mpByTag.get(tag) || 0;
  const diff = war - mp0;
  const pct = mp0 === 0 ? null : (diff / mp0) * 100;
  console.log(`\n=== MP_COMPARE ${tag} ===`);
  console.log(
    `${tag}\twar_relation_casualties=${war}\tmp_losses[0]=${mp0}\tdiff=${diff}\tdiff_pct=${pct == null ? 'n/a' : pct.toFixed(2) + '%'}`,
  );
}
