// Downloads raw source data into .data-cache/ (gitignored).
// Sources:
//  - kanji.json      : davidluzgouveia/kanji-data (KANJIDIC2 + JLPT N-levels)  [CC BY-SA]
//  - n1..n5.csv      : jamsinclair/open-anki-jlpt-decks (Tanos JLPT lists)    [CC BY]
//  - kanjivg-*.zip   : KanjiVG stroke order SVGs                              [CC BY-SA]
//  - examples.utf.gz : EDRDG Tanaka Corpus example sentences                  [CC BY]
import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.data-cache');
mkdirSync(cache, { recursive: true });

const KANJIVG_VERSION = '20250816';

const files = [
  {
    name: 'kanji.json',
    url: 'https://raw.githubusercontent.com/davidluzgouveia/kanji-data/master/kanji.json',
  },
  ...[1, 2, 3, 4, 5].map((n) => ({
    name: `n${n}.csv`,
    url: `https://raw.githubusercontent.com/jamsinclair/open-anki-jlpt-decks/main/src/n${n}.csv`,
  })),
  {
    name: 'kanjivg.zip',
    url: `https://github.com/KanjiVG/kanjivg/releases/download/r${KANJIVG_VERSION}/kanjivg-${KANJIVG_VERSION}-main.zip`,
  },
  {
    name: 'examples.utf.gz',
    url: 'http://ftp.edrdg.org/pub/Nihongo/examples.utf.gz',
  },
];

for (const f of files) {
  const dest = join(cache, f.name);
  if (existsSync(dest) && statSync(dest).size > 1000) {
    console.log(`skip   ${f.name} (cached, ${(statSync(dest).size / 1e6).toFixed(1)} MB)`);
    continue;
  }
  process.stdout.write(`fetch  ${f.name} ... `);
  const res = await fetch(f.url, { redirect: 'follow' });
  if (!res.ok) {
    console.error(`FAILED ${res.status} ${res.statusText} for ${f.url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
}
console.log('All source data cached in .data-cache/');
