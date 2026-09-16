import type { StudyItem } from './types';

export type Facet = 'k' | 'y' | 'e';

/**
 * The six quiz directions as [prompt, answer] facet pairs.
 * Progress counts (ProgressRow.c) are indexed by position in this array.
 */
export const DIRS: readonly (readonly [Facet, Facet])[] = [
  ['k', 'y'],
  ['y', 'k'],
  ['k', 'e'],
  ['e', 'k'],
  ['y', 'e'],
  ['e', 'y'],
] as const;

/** Directions available for an item (kana-only vocab has no kanji facet). */
export function activeDirs(item: Pick<StudyItem, 'hasKanjiFacet'>): number[] {
  return item.hasKanjiFacet ? [0, 1, 2, 3, 4, 5] : [4, 5];
}

export function promptTextFor(item: StudyItem, facet: Facet): string {
  switch (facet) {
    case 'k':
      return item.text;
    case 'y':
      return item.yomiPrompt;
    case 'e':
      return item.enPrompt;
  }
}

export function optionLabelFor(item: StudyItem, facet: Facet): string {
  switch (facet) {
    case 'k':
      return item.text;
    case 'y':
      return item.yomiOption;
    case 'e':
      return item.enShort;
  }
}
