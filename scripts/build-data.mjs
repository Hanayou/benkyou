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
import kuromoji from 'kuromoji';

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
  sentences.push({ ja, en, good, b: i + 1 });
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

// ---------------------------------------------------------------- furigana
// Readings come from two sources, most trusted first:
//  1. Tanaka Corpus B-line annotations — human-curated readings that exist
//     precisely where words are ambiguous (行く(いく) vs ゆく, 二十歳(はたち)).
//  2. kuromoji (IPADIC) morphological analysis for everything else.
// A span neither source is confident about gets NO furigana — absent beats wrong.
const kata2hira = (s) =>
  s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
const HAS_KANJI = /[㐀-鿿豈-﫿々〆]/;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

process.stdout.write('loading kuromoji dictionary... ');
const tokenizer = await new Promise((resolve, reject) =>
  kuromoji
    .builder({ dicPath: join(root, 'node_modules', 'kuromoji', 'dict') })
    .build((err, t) => (err ? reject(err) : resolve(t)))
);
console.log('ok');

// Split `surface` into [text, ruby|null] segments: rubies cover exactly the
// kanji runs, and the kana runs must match `reading` (hiragana) literally.
function fit(surface, reading) {
  if (!HAS_KANJI.test(surface)) return null;
  if (kata2hira(surface) === reading) return null;
  const runs = surface.match(/([㐀-鿿豈-﫿々〆]+|[^㐀-鿿豈-﫿々〆]+)/g) ?? [];
  let re = '^';
  for (const run of runs) re += HAS_KANJI.test(run[0]) ? '(.+?)' : escRe(kata2hira(run));
  const m = reading.match(new RegExp(re + '$'));
  if (!m) return [[surface, reading]]; // can't split — one ruby over the whole span
  let g = 0;
  const segs = [];
  for (const run of runs) {
    if (HAS_KANJI.test(run[0])) segs.push([run, m[++g]]);
    else segs.push([run, null]);
  }
  return segs;
}

// Gold segments for a B-line token: `base(reading)` appearing in the sentence
// as `surface` (identical, conjugated, or an alternate writing).
function goldFor(base, reading, surface) {
  if (!HAS_KANJI.test(surface)) return null;
  if (surface === base) return fit(base, reading);
  const baseSegs = fit(base, reading);
  if (baseSegs) {
    let lastK = -1;
    baseSegs.forEach((s, i) => {
      if (s[1]) lastK = i;
    });
    if (lastK >= 0) {
      const prefix = baseSegs.slice(0, lastK + 1);
      const prefixText = prefix.map((s) => s[0]).join('');
      const rest = surface.slice(prefixText.length);
      if (surface.startsWith(prefixText) && !HAS_KANJI.test(rest)) {
        return rest ? [...prefix, [rest, null]] : prefix;
      }
    }
  }
  // alternate writing of a non-conjugating word (２０歳 for 二十歳(はたち))
  if (!/[ぁ-ゖァ-ヶ]$/.test(base)) return [[surface, reading]];
  return null;
}

// Replace [start, start+len) of segs with `gold`, cutting plain segments at
// the boundaries. If a ruby segment straddles a boundary, keep kuromoji's.
function patch(segs, start, len, gold) {
  const end = start + len;
  const out = [];
  let off = 0;
  let placed = false;
  for (const seg of segs) {
    const a = off;
    const b = off + seg.t.length;
    off = b;
    if (b <= start || a >= end) {
      out.push(seg);
      continue;
    }
    if (a < start) {
      if (seg.r) return;
      out.push({ t: seg.t.slice(0, start - a), r: null });
    }
    if (!placed) {
      for (const [t, r] of gold) out.push({ t, r });
      placed = true;
    }
    if (b > end) {
      if (seg.r) return;
      out.push({ t: seg.t.slice(end - a), r: null });
    }
  }
  if (placed) segs.splice(0, segs.length, ...out);
}

// Pure-kanji words from our own vocab lists with exactly one known reading —
// fixes number+counter words IPADIC splits into on-yomi pieces (一人 → イチ+ニン).
// Ambiguous words (一日: ついたち/いちにち) are excluded.
const vocabGold = new Map();
for (let n = 1; n <= 5; n++) {
  for (const it of vocabLists[n]) {
    const w = it.text;
    if (w.length < 2 || !/^[㐀-鿿豈-﫿々〆]+$/.test(w)) continue;
    if (vocabGold.has(w)) {
      if (vocabGold.get(w) !== it.kana) vocabGold.set(w, null);
    } else vocabGold.set(w, it.kana);
  }
}

const segCache = new Map();
function segmentsFor(idx) {
  let segs = segCache.get(idx);
  if (segs) return segs;
  const { ja, b } = sentences[idx];
  segs = [];
  for (const tok of tokenizer.tokenize(ja)) {
    const t = tok.surface_form;
    let sub = null;
    if (HAS_KANJI.test(t) && tok.reading && tok.reading !== '*') {
      sub = fit(t, kata2hira(tok.reading));
    }
    if (sub) for (const [txt, r] of sub) segs.push({ t: txt, r });
    else segs.push({ t, r: null });
  }
  // overlay known whole-word readings from the vocab lists; patch() refuses
  // any span whose boundaries disagree with the tokenization (大人 inside
  // 大人気 straddles kuromoji's 人気 token, so it is left alone)
  const runRe = /[㐀-鿿豈-﫿々〆]{2,}/g;
  let rm;
  while ((rm = runRe.exec(ja))) {
    const run = rm[0];
    let p = 0;
    while (p < run.length - 1) {
      let matched = 0;
      for (let l = Math.min(run.length - p, 6); l >= 2; l--) {
        const w = run.slice(p, p + l);
        const r = vocabGold.get(w);
        if (r) {
          patch(segs, rm.index + p, l, [[w, r]]);
          matched = l;
          break;
        }
      }
      p += matched || 1;
    }
  }
  // overlay curated readings from the B line
  let cursor = 0;
  for (const tokStr of lines[b].slice(3).split(' ')) {
    const m = TOKEN_RE.exec(tokStr);
    if (!m) continue;
    const [, base, reading, surface] = m;
    const span = surface || base;
    const pos = ja.indexOf(span, cursor);
    if (pos < 0) continue;
    cursor = pos + span.length;
    if (!reading) continue;
    const gold = goldFor(base, kata2hira(reading), span);
    if (gold) patch(segs, pos, span.length, gold);
  }
  segCache.set(idx, segs);
  return segs;
}

// Serialize one usage: compact segments, with the studied word marked.
// string = plain text; [t, r] = ruby; [t, r|null, 1] = highlighted.
function finishExample(idx, hl) {
  const s = sentences[idx];
  const segs = segmentsFor(idx);
  let h0 = -1;
  let h1 = -1;
  if (hl) {
    const p = s.ja.indexOf(hl);
    if (p >= 0) {
      h0 = p;
      h1 = p + hl.length;
    }
  }
  const out = [];
  const push = (t, r, h) => {
    if (!t) return;
    if (!r && !h && typeof out[out.length - 1] === 'string') out[out.length - 1] += t;
    else if (!r && !h) out.push(t);
    else if (h) out.push([t, r ?? null, 1]);
    else out.push([t, r]);
  };
  let off = 0;
  for (const seg of segs) {
    const a = off;
    const b = off + seg.t.length;
    off = b;
    if (h0 < 0 || b <= h0 || a >= h1) {
      push(seg.t, seg.r, false);
    } else if (seg.r) {
      push(seg.t, seg.r, true); // ruby overlapping the word → mark whole segment
    } else {
      const s0 = Math.max(a, h0);
      const s1 = Math.min(b, h1);
      push(seg.t.slice(0, s0 - a), null, false);
      push(seg.t.slice(s0 - a, s1 - a), null, true);
      push(seg.t.slice(s1 - a), null, false);
    }
  }
  return { s: out, en: s.en };
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
      res.push(finishExample(c.idx, c.hl));
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
  JSON.stringify({ version: 4, built: new Date().toISOString().slice(0, 10), lists: meta })
);

console.log('lists:');
for (const m of meta) console.log(`  ${m.id.padEnd(10)} ${String(m.count).padStart(5)} items`);
console.log(`strokes: ${strokeHit} chars ok, ${strokeMiss} missing${missSamples.length ? ' (e.g. ' + missSamples.join(' ') + ')' : ''}, ${Object.keys(shards).length} shards`);
console.log(`examples: vocab ${vocabWithEx}/${vocabTotal}, kanji ${kanjiWithEx}/${kanjiTotal}`);
console.log(`sentences parsed: ${sentences.length}, furigana cached for ${segCache.size}`);
// eyeball a few furigana results
const showEx = (ex) =>
  ex.s.map((g) => (typeof g === 'string' ? g : g[1] ? `${g[0]}(${g[1]})` : g[0])).join('');
for (const [label, it] of [
  ['kanji-n5 行', kanjiLists[5].find((i) => i.text === '行')],
  ['vocab-n5 食べる', vocabLists[5].find((i) => i.text === '食べる')],
  ['vocab-n1 first', vocabLists[1].find((i) => i.ex?.length)],
]) {
  if (it?.ex?.length) console.log(`furigana ${label}: ${showEx(it.ex[0])}`);
}
