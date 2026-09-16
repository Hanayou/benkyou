export type Kind = 'kanji' | 'vocab';

export interface ListMeta {
  id: string;
  kind: Kind;
  level: number;
  title: string;
  count: number;
}

export interface ListsIndex {
  version: number;
  built: string;
  lists: ListMeta[];
}

/** [japanese, english, highlight-substring] */
export type Example = [string, string, string];

/** Raw item as shipped in public/data/list/*.json */
export interface RawItem {
  id: string;
  text: string;
  kana?: string;
  on?: string[];
  kun?: string[];
  en: string[];
  ex?: Example[];
}

export interface RawList {
  id: string;
  kind: Kind;
  level: number;
  items: RawItem[];
}

/** Normalized item used throughout the app. */
export interface StudyItem {
  id: string;
  listId: string;
  kind: Kind;
  level: number;
  /** Kanji character, or vocab word as written. */
  text: string;
  /** Vocab reading (kana). Undefined for kanji items. */
  kana?: string;
  on: string[];
  kun: string[];
  en: string[];
  ex: Example[];
  /** false for kana-only vocab — those items only quiz yomi↔english. */
  hasKanjiFacet: boolean;
  /** Compact yomi label for answer buttons. */
  yomiOption: string;
  /** Full yomi for prompts/details; may contain \n between on and kun. */
  yomiPrompt: string;
  /** Compact english label for answer buttons. */
  enShort: string;
  /** English for prompts. */
  enPrompt: string;
  /** Normalized readings for distractor-collision checks. */
  yomiKeys: Set<string>;
  /** Normalized glosses for distractor-collision checks. */
  enKeys: Set<string>;
  /** Lowercase english blob for search. */
  searchEn: string;
  /** Normalized kana blob for search. */
  searchKana: string;
}
