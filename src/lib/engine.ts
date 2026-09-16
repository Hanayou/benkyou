import type { StudyItem } from './types';
import type { ProgressRow, RunRow } from './db';
import { DIRS, activeDirs, optionLabelFor, promptTextFor, type Facet } from './facets';

export interface QuizOption {
  label: string;
  item: StudyItem;
}

export interface Question {
  item: StudyItem;
  dir: number;
  prompt: Facet;
  answer: Facet;
  promptText: string;
  options: QuizOption[];
  correct: number;
}

export interface AnswerResult {
  correct: boolean;
  groupDone: boolean;
  listDone: boolean;
  row: ProgressRow;
}

/**
 * The drill session. Keeps a "working set" of the first `wsSize` unfinished
 * groups in list order; maxed-out groups retire and the next unfinished group
 * is pulled in. Mutates the run row and progress rows it was given — the
 * caller persists them after each answer.
 */
export class QuizSession {
  private ws: StudyItem[] = [];
  private cursor = 0;
  private lastItemId: string | null = null;
  private lastAsk: string | null = null;

  constructor(
    private items: StudyItem[],
    private rowById: Map<string, ProgressRow>,
    public run: RunRow,
    wsSize: number,
    private rng: () => number = Math.random
  ) {
    while (this.ws.length < wsSize && this.cursor < items.length) {
      const it = items[this.cursor++];
      if (!this.rowById.get(it.id)?.done) this.ws.push(it);
    }
  }

  get workingSetSize(): number {
    return this.ws.length;
  }

  listDone(): boolean {
    return this.ws.length === 0;
  }

  next(): Question | null {
    if (!this.ws.length) return null;
    const pool =
      this.ws.length > 1 && this.lastItemId
        ? this.ws.filter((i) => i.id !== this.lastItemId)
        : this.ws;
    const item = pool[Math.floor(this.rng() * pool.length)];
    const row = this.rowById.get(item.id)!;

    let dirs = activeDirs(item).filter((d) => row.c[d] < this.run.maxPer);
    if (dirs.length === 0) dirs = activeDirs(item); // shouldn't happen; be safe
    if (dirs.length > 1 && this.lastAsk) {
      const fresh = dirs.filter((d) => `${item.id}:${d}` !== this.lastAsk);
      if (fresh.length) dirs = fresh;
    }
    const dir = dirs[Math.floor(this.rng() * dirs.length)];
    this.lastItemId = item.id;
    this.lastAsk = `${item.id}:${dir}`;

    const [prompt, answer] = DIRS[dir];
    const options = this.buildOptions(item, answer);
    const correct = Math.floor(this.rng() * (options.length + 1));
    options.splice(correct, 0, { label: optionLabelFor(item, answer), item });

    return { item, dir, prompt, answer, promptText: promptTextFor(item, prompt), options, correct };
  }

  answer(q: Question, choice: number): AnswerResult {
    const correct = choice === q.correct;
    const row = this.rowById.get(q.item.id)!;
    let groupDone = false;

    if (correct && row.c[q.dir] < this.run.maxPer) {
      row.c = row.c.slice();
      row.c[q.dir]++;
      this.run.points++;
      const dirs = activeDirs(q.item);
      if (dirs.every((d) => row.c[d] >= this.run.maxPer)) {
        row.done = 1;
        groupDone = true;
        this.run.doneGroups++;
        this.ws = this.ws.filter((i) => i.id !== q.item.id);
        while (this.cursor < this.items.length) {
          const next = this.items[this.cursor++];
          if (!this.rowById.get(next.id)?.done) {
            this.ws.push(next);
            break;
          }
        }
      }
    }

    const listDone = this.ws.length === 0;
    if (listDone && !this.run.finishedAt) this.run.finishedAt = Date.now();
    return { correct, groupDone, listDone, row };
  }

  /**
   * True when the two items could plausibly both be "correct" for a question
   * about `a` — shared reading or shared gloss — or would render identically.
   */
  private conflicts(a: StudyItem, b: StudyItem, facet: Facet): boolean {
    if (optionLabelFor(a, facet) === optionLabelFor(b, facet)) return true;
    for (const k of a.yomiKeys) if (b.yomiKeys.has(k)) return true;
    for (const k of a.enKeys) if (b.enKeys.has(k)) return true;
    return false;
  }

  private buildOptions(target: StudyItem, facet: Facet): QuizOption[] {
    const res: QuizOption[] = [];
    const used = new Set([optionLabelFor(target, facet)]);
    const n = this.items.length;
    let tries = 0;
    while (res.length < 3 && tries < 90) {
      tries++;
      const cand = this.items[Math.floor(this.rng() * n)];
      if (cand.id === target.id) continue;
      if (facet === 'k' && !cand.hasKanjiFacet) continue;
      const label = optionLabelFor(cand, facet);
      if (used.has(label)) continue;
      if (tries < 70 && this.conflicts(target, cand, facet)) continue;
      used.add(label);
      res.push({ label, item: cand });
    }
    if (res.length < 3) {
      // tiny/homogeneous list fallback: linear scan, label-distinct only
      for (const cand of this.items) {
        if (res.length >= 3) break;
        if (cand.id === target.id) continue;
        if (facet === 'k' && !cand.hasKanjiFacet) continue;
        const label = optionLabelFor(cand, facet);
        if (used.has(label)) continue;
        used.add(label);
        res.push({ label, item: cand });
      }
    }
    return res;
  }
}
