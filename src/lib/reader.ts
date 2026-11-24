const BASE = import.meta.env.BASE_URL;

export interface ReaderChapterMeta {
  id: string;
  title: string;
  titleEn: string;
  focus: string[];
  sents: number;
  chars: number;
  newWords: number;
}

export interface ReaderCharacter {
  name: string;
  kana: string;
  desc: string;
  register: string;
}

export interface ReaderBook {
  id: string;
  title: string;
  titleKana: string;
  titleEn: string;
  tagline: string;
  taglineEn: string;
  level: string;
  genre: string;
  registers: string[];
  characters: ReaderCharacter[];
  chapters: ReaderChapterMeta[];
}

export interface ReaderIndex {
  version: number;
  built: string;
  books: ReaderBook[];
}

/** "text" plain · [text, number] vocab index · [text, string] glossary key */
export type RToken = string | [string, number] | [string, string];

export interface RSent {
  t: RToken[];
  en: string;
}

export interface RPara {
  sp?: string;
  hr?: 1; // scene break
  s: RSent[];
}

export interface RVocab {
  t: string;
  r: string;
  g: string;
  b?: string;
  n?: boolean;
}

export interface GlossEntry {
  type: string;
  short: string;
  note?: string;
  jlpt?: string;
}

export interface ReaderChapter {
  id: string;
  title: string;
  titleEn: string;
  focus: string[];
  paras: RPara[];
  vocab: RVocab[];
  grammar: string[];
  clozeRefs: Record<string, [number, number][]>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json();
}

let indexP: Promise<ReaderIndex> | null = null;
export function getReaderIndex(): Promise<ReaderIndex> {
  return (indexP ??= fetchJson<ReaderIndex>('data/reader/index.json'));
}

let glossP: Promise<Record<string, GlossEntry>> | null = null;
export function getGlossary(): Promise<Record<string, GlossEntry>> {
  return (glossP ??= fetchJson<Record<string, GlossEntry>>('data/reader/glossary.json'));
}

const chapterCache = new Map<string, Promise<ReaderChapter>>();
export function getChapter(bookId: string, chId: string): Promise<ReaderChapter> {
  const key = `${bookId}/${chId}`;
  let p = chapterCache.get(key);
  if (!p) {
    p = fetchJson<ReaderChapter>(`data/reader/${bookId}/${chId}.json`);
    chapterCache.set(key, p);
  }
  return p;
}

/** Plain text of a sentence (for cloze building and sentence display). */
export function sentText(s: RSent): string {
  return s.t.map((t) => (typeof t === 'string' ? t : t[0])).join('');
}
