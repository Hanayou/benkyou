// Compiles content/reader/ into public/data/reader/.
//
// Every sentence is segmented greedily (longest match wins) against the
// sentence's own word annotations (w) plus the shared glossary. Any Japanese
// span that neither source covers FAILS the build — that is the guarantee
// behind "tap anything, get an explanation".
//
// Output token encoding (compact):
//   "text"            plain (punctuation, numbers)
//   [text, vocabIdx]  word — index into the chapter vocab table
//   [text, "key"]     function word / grammar — key into glossary.json
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'content', 'reader');
const outDir = join(root, 'public', 'data', 'reader');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const glossary = JSON.parse(readFileSync(join(srcDir, 'glossary.json'), 'utf8'));
delete glossary._comment;
// Alias entries ({"of": "ずにはいられない"}) are conjugated surfaces of a
// canonical pattern: they tokenize on their own surface but resolve to the
// canonical key for popups, focus counting and cloze questions.
for (const [k, e] of Object.entries(glossary)) {
  if (e.of && !glossary[e.of]) throw new Error(`glossary alias 「${k}」 points at missing 「${e.of}」`);
}
const canon = (k) => glossary[k].of ?? k;
const glossKeys = Object.keys(glossary).sort((a, b) => b.length - a.length);

const PUNCT = /[\s　。、！？!?…‥——―「」『』（）()《》〈〉・，,.：:；;≪≫]/;
const DIGIT = /[0-9０-９a-zA-Zａ-ｚＡ-Ｚ％%]/;
const KANA_READING = /^[ぁ-ゖーゝゞ]+$/;

const errors = [];
const warnings = [];

function tokenize(jp, w, where) {
  const wKeys = Object.keys(w).sort((a, b) => b.length - a.length);
  // Author word annotations outrank greedy glossary matching: a glossary
  // match may never swallow the start of a w match further along (のに must
  // not eat the の before におい).
  const wStart = new Array(jp.length).fill(false);
  for (let p = 0; p < jp.length; p++) {
    for (const k of wKeys) {
      if (jp.startsWith(k, p)) {
        wStart[p] = true;
        break;
      }
    }
  }
  const capAt = (pos) => {
    for (let p = pos + 1; p < jp.length; p++) if (wStart[p]) return p - pos;
    return Infinity;
  };
  const tokens = [];
  let pos = 0;
  let plain = '';
  const flushPlain = () => {
    if (plain) {
      tokens.push(plain);
      plain = '';
    }
  };
  while (pos < jp.length) {
    let best = null; // {len, kind, key}
    for (const k of wKeys) {
      if (jp.startsWith(k, pos)) {
        best = { len: k.length, kind: 'w', key: k };
        break; // wKeys sorted longest-first; w beats glossary at equal length
      }
    }
    const cap = best ? Infinity : capAt(pos);
    for (const k of glossKeys) {
      if (k.length <= (best?.len ?? 0)) break;
      if (k.length > cap) continue;
      if (jp.startsWith(k, pos)) {
        best = { len: k.length, kind: 'g', key: k };
        break;
      }
    }
    if (best) {
      flushPlain();
      tokens.push({ kind: best.kind, key: best.key });
      pos += best.len;
      continue;
    }
    const ch = jp[pos];
    if (PUNCT.test(ch) || DIGIT.test(ch)) {
      plain += ch;
      pos++;
      continue;
    }
    errors.push(`${where}: no annotation covers 「${ch}」 at position ${pos} in: ${jp}`);
    plain += ch;
    pos++;
  }
  flushPlain();
  return tokens;
}

function parseW(raw, where) {
  const out = {};
  for (const [key, val] of Object.entries(raw)) {
    const parts = val.split('|');
    if (parts.length < 2) {
      errors.push(`${where}: w entry 「${key}」 needs "reading|gloss[|base]" — got "${val}"`);
      continue;
    }
    const [r, g, b] = parts;
    if (!KANA_READING.test(r)) {
      errors.push(`${where}: reading for 「${key}」 is not pure kana: "${r}"`);
    }
    out[key] = { r, g, b: b || undefined };
  }
  return out;
}

const index = { version: 1, built: new Date().toISOString().slice(0, 10), books: [] };

for (const bookId of readdirSync(join(srcDir, 'books'))) {
  const bookDir = join(srcDir, 'books', bookId);
  const book = JSON.parse(readFileSync(join(bookDir, 'book.json'), 'utf8'));
  mkdirSync(join(outDir, bookId), { recursive: true });

  // Optional book lexicon (lexicon.json) + per-chapter "lex": word annotations
  // that apply to every sentence — names, coined terms, words that recur
  // constantly. Same "reading|gloss|base" format; sentence w always wins.
  // Keys must be ≥2 chars so a lexicon entry can't silently mis-read a kanji
  // that is part of a longer word (any leftover span still fails the build).
  let bookLex = {};
  try {
    bookLex = parseW(JSON.parse(readFileSync(join(bookDir, 'lexicon.json'), 'utf8')), `${bookId}/lexicon`);
  } catch (e) {
    if (e.code !== 'ENOENT') errors.push(`${bookId}/lexicon.json: ${e.message}`);
  }
  const checkLex = (lex, where) => {
    for (const k of Object.keys(lex)) if ([...k].length < 2) errors.push(`${where}: lexicon key 「${k}」 must be ≥2 chars`);
  };
  checkLex(bookLex, `${bookId}/lexicon`);

  const ledger = new Set(); // vocab text|reading seen in earlier chapters
  const chapterMeta = [];

  // READER_CHAPTERS=ch1,ch2 limits a build to specific chapters (deploy gating)
  const only = process.env.READER_CHAPTERS?.split(',');
  for (const chId of book.chapters) {
    if (only && !only.includes(chId)) continue;
    const where0 = `${bookId}/${chId}`;
    let ch;
    try {
      ch = JSON.parse(readFileSync(join(bookDir, `${chId}.json`), 'utf8'));
    } catch (e) {
      if (e.code === 'ENOENT') {
        warnings.push(`${where0}: not written yet — book ships without it`);
      } else {
        errors.push(`${where0}: cannot read/parse — ${e.message}`);
      }
      continue;
    }
    for (const f of ch.focus ?? []) {
      if (!glossary[f]) errors.push(`${where0}: focus pattern 「${f}」 is not in glossary.json`);
    }

    const chLex = { ...bookLex, ...parseW(ch.lex ?? {}, `${where0}/lex`) };
    checkLex(ch.lex ?? {}, `${where0}/lex`);
    const vocab = [];
    const vocabIdx = new Map(); // text|reading -> idx
    const grammarUsed = new Set();
    const clozeRefs = {};
    const paras = [];
    let sentCount = 0;
    let charCount = 0;

    ch.paras?.forEach((para, pi) => {
      if (para.hr) {
        paras.push({ hr: 1, s: [] }); // scene break — keeps para indices aligned for clozeRefs
        return;
      }
      const sents = [];
      para.s?.forEach((sent, si) => {
        const where = `${where0} ¶${pi + 1}.${si + 1}`;
        if (!sent.jp || !sent.en) errors.push(`${where}: sentence needs jp and en`);
        const ownW = parseW(sent.w ?? {}, where);
        const w = { ...chLex, ...ownW };
        const toks = tokenize(sent.jp ?? '', w, where);
        const usedW = new Set();
        const t = toks.map((tok) => {
          if (typeof tok === 'string') return tok;
          if (tok.kind === 'w') {
            usedW.add(tok.key);
            const info = w[tok.key];
            const vkey = `${tok.key}|${info.r}`;
            let idx = vocabIdx.get(vkey);
            if (idx === undefined) {
              idx = vocab.length;
              vocabIdx.set(vkey, idx);
              vocab.push({ t: tok.key, r: info.r, g: info.g, b: info.b, n: !ledger.has(vkey) });
            }
            return [tok.key, idx];
          }
          const ck = canon(tok.key);
          grammarUsed.add(ck);
          if ((ch.focus ?? []).includes(ck)) {
            (clozeRefs[ck] ??= []).push([pi, si]);
          }
          return [tok.key, ck];
        });
        for (const k of Object.keys(ownW)) {
          if (!usedW.has(k)) warnings.push(`${where}: w entry 「${k}」 never matched in the sentence`);
        }
        sents.push({ t, en: sent.en });
        sentCount++;
        charCount += (sent.jp ?? '').length;
      });
      paras.push(para.sp ? { sp: para.sp, s: sents } : { s: sents });
    });

    for (const f of ch.focus ?? []) {
      if (!clozeRefs[f]) warnings.push(`${where0}: focus pattern 「${f}」 never appears in the text`);
      else if (clozeRefs[f].length < 2)
        warnings.push(`${where0}: focus pattern 「${f}」 appears only once — recurrence target is ≥2`);
    }

    const newWords = vocab.filter((v) => v.n);
    for (const v of vocab) ledger.add(`${v.t}|${v.r}`);

    const grammar = [...grammarUsed]
      .filter((k) => glossary[k].jlpt || (ch.focus ?? []).includes(k))
      .sort((a, b) => ((ch.focus ?? []).includes(b) ? 1 : 0) - ((ch.focus ?? []).includes(a) ? 1 : 0));

    writeFileSync(
      join(outDir, bookId, `${chId}.json`),
      JSON.stringify({ id: chId, title: ch.title, titleEn: ch.titleEn, focus: ch.focus ?? [], paras, vocab, grammar, clozeRefs })
    );
    chapterMeta.push({
      id: chId,
      title: ch.title,
      titleEn: ch.titleEn,
      focus: ch.focus ?? [],
      sents: sentCount,
      chars: charCount,
      newWords: newWords.length,
    });
    console.log(
      `${where0}: ${sentCount} sentences, ${charCount} chars, ${vocab.length} vocab (${newWords.length} new), ${grammarUsed.size} grammar keys`
    );
  }

  index.books.push({
    order: book.order ?? 99,
    id: book.id,
    title: book.title,
    titleKana: book.titleKana,
    titleEn: book.titleEn,
    tagline: book.tagline,
    taglineEn: book.taglineEn,
    level: book.level,
    genre: book.genre,
    registers: book.registers,
    characters: book.characters,
    chapters: chapterMeta,
  });
}

index.books.sort((a, b) => a.order - b.order);
writeFileSync(join(outDir, 'index.json'), JSON.stringify(index));
writeFileSync(join(outDir, 'glossary.json'), JSON.stringify(glossary));

if (warnings.length) {
  console.log(`\n${warnings.length} warning(s):`);
  for (const wn of warnings) console.log('  ⚠ ' + wn);
}
if (errors.length) {
  console.error(`\n${errors.length} ERROR(S):`);
  for (const e of errors) console.error('  ✖ ' + e);
  process.exit(1);
}
console.log('\nreader data OK');
