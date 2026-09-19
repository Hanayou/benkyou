// Builds public/data/ from .data-cache/ sources. Run `npm run data:fetch` first.
//
// Outputs:
//   public/data/lists.json                    — list metadata
//   public/data/list/{kanji|vocab}-n{1..5}.json — items (readings, meanings, examples)
//   public/data/strokes/{hh}.json             — KanjiVG stroke shards keyed by codepoint hex
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { unzipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.data-cache');
const out = join(root, 'public', 'data');
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'list'), { recursive: true });
mkdirSync(join(out, 'strokes'), { recursive: true });

const KANJI_RE = /[㐀-鿿豈-﫿々]/;

// ---------------------------------------------------------------- kanji lists
const hira2kata = (s) =>
  s.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));

const kanjiRaw = JSON.parse(readFileSync(join(cache, 'kanji.json'), 'utf8'));
const kanjiLists = {}; // level -> items
for (let n = 1; n <= 5; n++) kanjiLists[n] = [];
for (const [char, k] of Object.entries(kanjiRaw)) {
  const n = k.jlpt_new;
  if (!n || n < 1 || n > 5) continue;
  let meanings = (k.meanings || []).filter((m) => !/radical \(no/i.test(m));
  if (!meanings.length) meanings = k.meanings || [];
  const on = (k.readings_on || []).map(hira2kata);
  const kun = k.readings_kun || [];
  if (!meanings.length || (!on.length && !kun.length)) continue;
  kanjiLists[n].push({
    id: char,
    text: char,
    on,
    kun,
    en: meanings.slice(0, 8),
    _freq: k.freq ?? 99999,
    _strokes: k.strokes ?? 99,
  });
}
for (let n = 1; n <= 5; n++) {
  kanjiLists[n].sort((a, b) => a._freq - b._freq || a._strokes - b._strokes);
  for (const it of kanjiLists[n]) {
    delete it._freq;
    delete it._strokes;
  }
}

// ---------------------------------------------------------------- vocab lists
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; if (row.some((f) => f !== '')) rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f !== '')) rows.push(row); }
  return rows;
}

// Split a meaning string into glosses on top-level ';' and ',' (not inside parens).
function splitGlosses(s) {
  const parts = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    if ((c === ';' || c === ',') && depth === 0) { parts.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  parts.push(cur.trim());
  return parts.filter(Boolean);
}

const vocabLists = {};
for (let n = 1; n <= 5; n++) {
  const rows = parseCsv(readFileSync(join(cache, `n${n}.csv`), 'utf8'));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const iExpr = header.indexOf('expression');
  const iRead = header.indexOf('reading');
  const iMean = header.indexOf('meaning');
  const seen = new Set();
  const items = [];
  for (const r of rows.slice(1)) {
    // Some entries list alternate writings/readings ("足; 脚") — keep the primary one.
    const text = (r[iExpr] || '').split(/[;；]/)[0].trim();
    const kana = (((r[iRead] || '').split(/[;；]/)[0].trim()) || text).trim();
    const en = splitGlosses(r[iMean] || '').slice(0, 6);
    if (!text || !en.length) continue;
    const id = `${text}|${kana}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, text, kana, en });
  }
  vocabLists[n] = items;
}

// ------------------------------------------------ trim kanji readings/meanings
// Keep only the readings a learner actually needs. Each reading is scored by
// how often it appears inside JLPT vocabulary containing that kanji (weighted
// toward lower levels); per word only the longest matching stem gets credit so
// substrings like く don't steal points from しょく. Top 2 kun + top 2 on are
// kept (rare readings are better absorbed through vocab study), meanings cap
// at 3 (KANJIDIC2 lists the primary gloss first).
const kata2hira = (s) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const DAKUTEN = { か: 'が', き: 'ぎ', く: 'ぐ', け: 'げ', こ: 'ご', さ: 'ざ', し: 'じ', す: 'ず', せ: 'ぜ', そ: 'ぞ', た: 'だ', ち: 'ぢ', つ: 'づ', て: 'で', と: 'ど', は: 'ば', ひ: 'び', ふ: 'ぶ', へ: 'べ', ほ: 'ぼ' };
const HANDAKUTEN = { は: 'ぱ', ひ: 'ぴ', ふ: 'ぷ', へ: 'ぺ', ほ: 'ぽ' };

function variantsOf(base) {
  if (!base) return [];
  const v = new Set([base]);
  const d = DAKUTEN[base[0]];
  if (d) v.add(d + base.slice(1));
  const h = HANDAKUTEN[base[0]];
  if (h) v.add(h + base.slice(1));
  if (base.length > 1 && /[くきつち]$/.test(base)) v.add(base.slice(0, -1) + 'っ');
  return [...v];
}

function readingBases(reading) {
  const clean = kata2hira(reading).replace(/-/g, '');
  const [rawStem, okurigana] = clean.split('.');
  // A one-kana stem like the い of い.きる would match い anywhere, letting
  // sibling readings free-ride on each other's words — anchor it with the
  // first okurigana character (い.きる → いき).
  const stem = rawStem.length === 1 && okurigana ? rawStem + okurigana[0] : rawStem;
  // Anchored base for ALL okurigana readings: stem + first okurigana kana
  // (ひろ.がる → ひろが). Evidence for THIS verb specifically, immune to the
  // shared-stem free-riding that makes 広まる tie with 広がる.
  const aBase = okurigana ? rawStem + okurigana[0] : rawStem;
  return { stem, variants: variantsOf(stem), dotted: !!okurigana, aBase, aVariants: variantsOf(aBase) };
}

const charWords = new Map(); // kanji char -> [{kana, weight}]
for (let n = 1; n <= 5; n++) {
  for (const it of vocabLists[n]) {
    const kana = kata2hira(it.kana);
    for (const ch of new Set(it.text)) {
      if (!KANJI_RE.test(ch)) continue;
      let arr = charWords.get(ch);
      if (!arr) charWords.set(ch, (arr = []));
      arr.push({ kana, weight: n }); // N5 words count 5×, N1 words 1×
    }
  }
}

const MAX_PER_CAT = 3; // always keep up to this many evidenced readings per category
const SOFT_MAX = 5; // …stretch to this many while a reading has MIN_KEEP_EVIDENCE
const MIN_KEEP_EVIDENCE = 2; // ≈ one N2 word's weight of usage
// transitive/intransitive suffix alternations — a kept verb pulls its partner
const PAIRS = [
  ['る', 'す'], ['れる', 'す'], ['まる', 'める'], ['がる', 'げる'], ['む', 'める'],
  ['りる', 'ろす'], ['える', 'やす'], ['く', 'ける'], ['ける', 'かす'], ['める', 'ます'],
  ['つ', 'てる'], ['ぶ', 'ばす'],
];
// Hand-curated corrections for readings the JLPT vocab lists can't score:
// common words that appear in no list (応える, ふところ), or KANJIDIC quirks
// where dictionary order front-loads classical readings (透 とう.る).
const OVERRIDES = {
  '応': { keep: ['こた.える'], drop: ['あた.る', 'まさに'] },
  '透': { keep: ['す.ける', 'す.かす', 'す.く'], drop: ['とう.る', 'とう.す'] },
  '懐': { keep: ['ふところ'] },
  '即': { keep: ['すなわ.ち'], drop: ['つ.く', 'つ.ける'] },
  '仰': { keep: ['お.っしゃる'] },
  '浸': { keep: ['つ.かる'] },
  '潜': { keep: ['くぐ.る'] },
  '明': { keep: ['あき.らか'], drop: ['あか.るむ'] },
  '上': { keep: ['かみ'], drop: ['のぼ.す'] },
};

function isTransPair(a, b) {
  for (const [x, y] of PAIRS) {
    for (const [s1, s2] of [[x, y], [y, x]]) {
      if (
        a.length > s1.length && b.length > s2.length &&
        a.endsWith(s1) && b.endsWith(s2) &&
        a.slice(0, -s1.length) === b.slice(0, -s2.length)
      )
        return true;
    }
  }
  return false;
}
// final-kana → い-row, to unify a verb with its conjugated/masu-stem variants
const IROW = { く: 'き', ぐ: 'ぎ', う: 'い', つ: 'ち', む: 'み', ぶ: 'び', ぬ: 'に', る: 'り', す: 'し', ず: 'じ' };
let readingsBefore = 0;
let readingsAfter = 0;
let droppedUsed = 0;
const trimReport = [];
for (let n = 1; n <= 5; n++) {
  for (const it of kanjiLists[n]) {
    const words = charWords.get(it.text) ?? [];
    // score all readings jointly; per word, only the longest matching stem scores
    const all = [
      ...it.on.map((r, i) => ({ r, i, cat: 'on', ...readingBases(r), score: 0, aScore: 0 })),
      ...it.kun.map((r, i) => ({ r, i, cat: 'kun', ...readingBases(r), score: 0, aScore: 0 })),
    ];
    for (const w of words) {
      let best = 0;
      const hits = [];
      for (const c of all) {
        if (c.stem && c.variants.some((v) => w.kana.includes(v))) {
          hits.push(c);
          if (c.stem.length > best) best = c.stem.length;
        }
        // the reading standing alone as a whole word (上 うえ) is the
        // strongest signal it must be taught — count it double
        if (c.aBase && c.aVariants.some((v) => w.kana.includes(v)))
          c.aScore += w.weight * (c.aVariants.includes(w.kana) ? 2 : 1);
      }
      for (const c of hits)
        if (c.stem.length === best)
          c.score += w.weight * (c.variants.includes(w.kana) ? 2 : 1);
    }
    if (process.env.DEBUG_KANJI?.includes(it.text)) {
      console.log(`DEBUG ${it.text}: words=${words.length}`);
      for (const c of all)
        console.log(`  ${c.cat} ${c.r} stem=${c.stem} aBase=${c.aBase} score=${c.score} aScore=${c.aScore}`);
    }
    // Group reading variants into families before ranking: identical
    // normalized forms (うし.ろ/うしろ), prefix relations (うまれ/う.まれる),
    // and conjugation pairs of the same verb (い.く/-い.き, via mapping the
    // final kana to its い-row) pool their evidence. An okurigana reading
    // counts only its ANCHORED score — its own verb, not the shared stem, so
    // 広まる can't ride on 広がる's words; dotless readings count their stem
    // score. The top MAX_PER_CAT families are kept, stretching to SOFT_MAX
    // while a family stays within REL_KEEP of the leader. Kun keeps at least
    // 2 (dictionary order) even with no JLPT-vocab evidence — common verbs
    // like 企む simply never appear in the lists.
    const pick = (cat) => {
      const groups = [];
      for (const c of all) {
        if (c.cat !== cat) continue;
        const norm = kata2hira(c.r).replace(/[.\-]/g, '');
        if (!norm) continue;
        const last = IROW[norm[norm.length - 1]];
        const fam = norm.length >= 2 && last ? norm.slice(0, -1) + last : norm;
        const g = groups.find(
          (g) =>
            g.fam === fam ||
            (g.norm.length >= 2 && norm.startsWith(g.norm)) ||
            (norm.length >= 2 && g.norm.startsWith(norm))
        );
        const key = c.dotted ? `a:${c.aBase}` : `s:${c.stem}`;
        const contrib = c.dotted ? c.aScore : c.score;
        if (g) {
          // variants sharing an evidence base matched the same words — count once
          g.members++;
          if (!g.keys.has(key)) {
            g.keys.add(key);
            g.eff += contrib;
            g.raw += c.score;
            if (norm.length < g.norm.length) g.norm = norm;
          }
          // show the family as its plain form, not an affix variant (ひと- → ひと.つ)
          if (g.rep.includes('-') && !c.r.includes('-')) g.rep = c.r;
        } else {
          groups.push({ fam, norm, keys: new Set([key]), rep: c.r, i: c.i, eff: contrib, raw: c.score, members: 1 });
        }
      }
      groups.sort((a, b) => b.eff - a.eff || b.raw - a.raw || a.i - b.i);
      const used = groups.filter((g) => g.eff > 0);
      const kept = used.filter(
        (g, idx) => idx < MAX_PER_CAT || (idx < SOFT_MAX && g.eff >= MIN_KEEP_EVIDENCE)
      );
      // floor counts dictionary entries covered, so a family that already
      // absorbed two listed forms (扱い/扱う) doesn't drag in a junk third
      const floor = cat === 'kun' ? 2 : 1;
      let covered = kept.reduce((s, g) => s + g.members, 0);
      for (const g of groups) {
        if (covered >= floor) break;
        if (!kept.includes(g)) {
          kept.push(g);
          covered += g.members;
        }
      }
      // a kept verb's transitivity partner comes along (治る → 治す), provided
      // the partner's family shows any life in the vocab at all
      if (cat === 'kun') {
        for (const g of groups) {
          if (kept.length >= SOFT_MAX + 2) break;
          if (kept.includes(g) || (g.eff <= 0 && g.raw <= 0)) continue;
          if (kept.some((k) => isTransPair(k.norm, g.norm))) kept.push(g);
        }
      }
      return {
        kept: kept.map((g) => g.rep),
        dropped: groups.filter((g) => !kept.includes(g)).map((g) => ({ r: g.rep, score: g.eff })),
      };
    };
    readingsBefore += it.on.length + it.kun.length;
    const kun = pick('kun');
    const on = pick('on');
    it.kun = kun.kept;
    it.on = on.kept;
    const ov = OVERRIDES[it.text];
    if (ov) {
      if (ov.drop) {
        it.kun = it.kun.filter((r) => !ov.drop.includes(r));
        it.on = it.on.filter((r) => !ov.drop.includes(r));
      }
      for (const r of ov.keep ?? []) {
        if (it.kun.includes(r) || it.on.includes(r)) continue;
        (/[ァ-ヶ]/.test(r) ? it.on : it.kun).push(r);
      }
    }
    it.en = it.en.slice(0, 3);
    readingsAfter += it.on.length + it.kun.length;
    const dropped = [...kun.dropped, ...on.dropped].filter((d) => !(ov?.keep ?? []).includes(d.r));
    for (const r of ov?.drop ?? []) if (!dropped.some((d) => d.r === r)) dropped.push({ r, score: 0 });
    if (dropped.length) {
      for (const d of dropped) if (d.score > 0) droppedUsed++;
      trimReport.push(
        `${it.text} [N${n}]  kept: ${[...it.kun, ...it.on].join('・') || '—'}   dropped: ` +
          dropped.map((d) => `${d.r}${d.score > 0 ? `(!${d.score})` : ''}`).join('・')
      );
    }
  }
}
for (const sample of ['行', '生', '後', '上', '日', '難', '増', '汚']) {
  for (let n = 1; n <= 5; n++) {
    const it = kanjiLists[n].find((k) => k.text === sample);
    if (it) console.log(`trim ${sample}: kun ${it.kun.join('・') || '—'} | on ${it.on.join('・') || '—'} | ${it.en.join(', ')}`);
  }
}
writeFileSync(join(cache, 'trim-report.txt'), trimReport.join('\n'));
console.log(
  `readings trimmed: ${readingsBefore} → ${readingsAfter} (${droppedUsed} dropped despite vocab usage — see .data-cache/trim-report.txt, "(!n)" marks them)`
);

// ---------------------------------------------------------------- stroke data
const neededChars = new Set();
for (let n = 1; n <= 5; n++) {
  for (const it of kanjiLists[n]) neededChars.add(it.text);
  for (const it of vocabLists[n]) {
    for (const ch of it.text) neededChars.add(ch);
    for (const ch of it.kana) neededChars.add(ch);
  }
}

const zip = unzipSync(readFileSync(join(cache, 'kanjivg.zip')));
const svgByCp = new Map(); // codepoint -> svg text
for (const [name, data] of Object.entries(zip)) {
  const m = name.match(/(?:^|\/)([0-9a-f]{5})\.svg$/);
  if (m) svgByCp.set(parseInt(m[1], 16), data);
}

function parseKanjiVg(svgText) {
  const strokes = [];
  const pathRe = /<path\s+([^>]*)\/>/g;
  let m;
  while ((m = pathRe.exec(svgText))) {
    const attrs = m[1];
    const id = /id="kvg:[^"]*-s(\d+)"/.exec(attrs);
    const d = /\sd="([^"]+)"/.exec(attrs);
    if (id && d) strokes.push({ n: +id[1], d: d[1] });
  }
  strokes.sort((a, b) => a.n - b.n);
  const nums = [];
  const numRe = /<text\s+transform="matrix\([^)]*\s([\d.-]+)\s([\d.-]+)\)"[^>]*>(\d+)<\/text>/g;
  while ((m = numRe.exec(svgText))) {
    nums.push({ n: +m[3], x: +(+m[1]).toFixed(1), y: +(+m[2]).toFixed(1) });
  }
  nums.sort((a, b) => a.n - b.n);
  return { p: strokes.map((s) => s.d), n: nums.map((s) => [s.x, s.y]) };
}

const shards = {}; // 'hh' -> { '4e00': {p,n} }
let strokeHit = 0, strokeMiss = 0;
const missSamples = [];
for (const ch of neededChars) {
  const cp = ch.codePointAt(0);
  if (cp > 0xffff) { strokeMiss++; continue; }
  const svg = svgByCp.get(cp);
  if (!svg) { strokeMiss++; if (missSamples.length < 20) missSamples.push(ch); continue; }
  const parsed = parseKanjiVg(new TextDecoder().decode(svg));
  if (!parsed.p.length) { strokeMiss++; continue; }
  const shard = (cp >> 8).toString(16).padStart(2, '0');
  (shards[shard] ??= {})[cp.toString(16).padStart(4, '0')] = parsed;
  strokeHit++;
}
for (const [shard, data] of Object.entries(shards)) {
  writeFileSync(join(out, 'strokes', `${shard}.json`), JSON.stringify(data));
}

// ---------------------------------------------------------------- example sentences
const exText = gunzipSync(readFileSync(join(cache, 'examples.utf.gz'))).toString('utf8');
const lines = exText.split('\n');
const sentences = []; // {ja, en, good}
const baseMap = new Map(); // base -> [{idx, reading, surface, checked}]
const charMap = new Map(); // kanji char -> [idx]
const kanjiSet = new Set();
for (let n = 1; n <= 5; n++) for (const it of kanjiLists[n]) kanjiSet.add(it.text);

const TOKEN_RE = /^([^([{~]+)(?:\(([^)]*)\))?(?:\[\d+\])?(?:\{([^}]*)\})?(~)?$/;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  if (!line.startsWith('A: ')) continue;
  const tab = line.indexOf('\t');
  if (tab < 0) continue;
  const ja = line.slice(3, tab);
  let en = line.slice(tab + 1);
  const hash = en.indexOf('#ID=');
  if (hash >= 0) en = en.slice(0, hash);
  const bLine = lines[i + 1] || '';
  if (!bLine.startsWith('B: ')) continue;
  const idx = sentences.length;
  const good = bLine.includes('~');
  sentences.push({ ja, en, good });
  for (const tok of bLine.slice(3).split(' ')) {
    if (!tok) continue;
    const m = TOKEN_RE.exec(tok);
    if (!m) continue;
    const [, base, reading, surface, checked] = m;
    let arr = baseMap.get(base);
    if (!arr) baseMap.set(base, (arr = []));
    if (arr.length < 600) arr.push({ idx, reading, surface, checked: !!checked });
  }
  if (ja.length <= 42) {
    for (const ch of new Set(ja)) {
      if (kanjiSet.has(ch)) {
        let arr = charMap.get(ch);
        if (!arr) charMap.set(ch, (arr = []));
        if (arr.length < 500) arr.push(idx);
      }
    }
  }
}

function pickExamples(cands /* [{idx, score, hl}] */) {
  cands.sort((a, b) => a.score - b.score);
  const res = [];
  const seenEn = new Set();
  for (const relaxed of [false, true]) {
    for (const c of cands) {
      if (res.length >= 3) break;
      const s = sentences[c.idx];
      if (!relaxed && (s.ja.length > 46 || s.en.length > 110)) continue;
      if (seenEn.has(s.en)) continue;
      seenEn.add(s.en);
      res.push([s.ja, s.en, c.hl]);
    }
    if (res.length >= 3) break;
  }
  return res;
}

let vocabWithEx = 0, vocabTotal = 0;
for (let n = 1; n <= 5; n++) {
  for (const it of vocabLists[n]) {
    vocabTotal++;
    const key = it.text.replace(/[~～〜]/g, '');
    const entries = baseMap.get(key) || [];
    const readMatched = entries.filter((e) => !e.reading || e.reading === it.kana);
    const pool = readMatched.length ? readMatched : KANJI_RE.test(key) ? [] : entries;
    const cands = pool.map((e) => ({
      idx: e.idx,
      hl: e.surface || key,
      score: (e.checked ? 0 : 500) + (sentences[e.idx].good ? 0 : 200) + sentences[e.idx].ja.length,
    }));
    const ex = pickExamples(cands);
    if (ex.length) { it.ex = ex; vocabWithEx++; }
  }
}
let kanjiWithEx = 0, kanjiTotal = 0;
for (let n = 1; n <= 5; n++) {
  for (const it of kanjiLists[n]) {
    kanjiTotal++;
    const cands = (charMap.get(it.text) || []).map((idx) => ({
      idx,
      hl: it.text,
      score: (sentences[idx].good ? 0 : 300) + sentences[idx].ja.length,
    }));
    const ex = pickExamples(cands);
    if (ex.length) { it.ex = ex; kanjiWithEx++; }
  }
}

// ---------------------------------------------------------------- write lists
const meta = [];
for (const [kind, lists] of [['kanji', kanjiLists], ['vocab', vocabLists]]) {
  for (let n = 5; n >= 1; n--) {
    const id = `${kind}-n${n}`;
    const items = lists[n];
    writeFileSync(join(out, 'list', `${id}.json`), JSON.stringify({ id, kind, level: n, items }));
    meta.push({ id, kind, level: n, title: `N${n} ${kind === 'kanji' ? 'Kanji' : 'Vocabulary'}`, count: items.length });
  }
}
// Order: all kanji N5→N1, then all vocab N5→N1 (mirrors the classic app)
writeFileSync(
  join(out, 'lists.json'),
  JSON.stringify({ version: 2, built: new Date().toISOString().slice(0, 10), lists: meta })
);

console.log('lists:');
for (const m of meta) console.log(`  ${m.id.padEnd(10)} ${String(m.count).padStart(5)} items`);
console.log(`strokes: ${strokeHit} chars ok, ${strokeMiss} missing${missSamples.length ? ' (e.g. ' + missSamples.join(' ') + ')' : ''}, ${Object.keys(shards).length} shards`);
console.log(`examples: vocab ${vocabWithEx}/${vocabTotal}, kanji ${kanjiWithEx}/${kanjiTotal}`);
console.log(`sentences parsed: ${sentences.length}`);
