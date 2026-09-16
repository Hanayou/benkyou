export interface StrokeData {
  /** SVG path `d` strings in stroke order (KanjiVG, 109×109 viewBox). */
  p: string[];
  /** [x, y] label position for each stroke number. */
  n: [number, number][];
}

const BASE = import.meta.env.BASE_URL;
const shardCache = new Map<string, Promise<Record<string, StrokeData> | null>>();

function getShard(key: string): Promise<Record<string, StrokeData> | null> {
  let p = shardCache.get(key);
  if (!p) {
    p = fetch(`${BASE}data/strokes/${key}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    shardCache.set(key, p);
  }
  return p;
}

export async function getStrokes(char: string): Promise<StrokeData | null> {
  const cp = char.codePointAt(0);
  if (!cp || cp > 0xffff) return null;
  const shard = await getShard((cp >> 8).toString(16).padStart(2, '0'));
  return shard?.[cp.toString(16).padStart(4, '0')] ?? null;
}

/** Characters worth showing a stroke diagram for (kana + kanji). */
export function isDrawable(char: string): boolean {
  const cp = char.codePointAt(0) ?? 0;
  return (
    (cp >= 0x3041 && cp <= 0x30f6) || // kana
    (cp >= 0x3400 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    char === '々'
  );
}
