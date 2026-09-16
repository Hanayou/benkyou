import Dexie, { type Table } from 'dexie';
import type { StudyItem } from './types';
import { activeDirs } from './facets';

/**
 * One row per started list ("run"). maxPer is locked in when the list is
 * started and only changes by resetting the list.
 */
export interface RunRow {
  listId: string;
  startedAt: number;
  maxPer: number;
  /** Total points achievable: Σ per item (active directions × maxPer). */
  total: number;
  /** Points earned so far. */
  points: number;
  doneGroups: number;
  finishedAt?: number;
}

/** Per-item progress, FK to the static item data by (listId, itemId). */
export interface ProgressRow {
  listId: string;
  itemId: string;
  /** Item's position in the list, for working-set ordering. */
  idx: number;
  /** Correct-answer counts per direction (see DIRS in facets.ts). */
  c: number[];
  done: 0 | 1;
}

class BenkyouDB extends Dexie {
  runs!: Table<RunRow, string>;
  progress!: Table<ProgressRow, [string, string]>;

  constructor() {
    super('benkyou');
    this.version(1).stores({
      runs: 'listId',
      progress: '[listId+itemId], listId',
    });
  }
}

export const db = new BenkyouDB();

/**
 * Load (or create) the run for a list plus all its progress rows.
 * Aggregates on the run row are recomputed from the rows so they stay honest
 * even if the underlying list data changed between app versions.
 */
export async function openRun(
  listId: string,
  items: StudyItem[],
  defaultMaxPer: number
): Promise<{ run: RunRow; rowById: Map<string, ProgressRow> }> {
  let run = await db.runs.get(listId);
  const isNew = !run;
  if (!run) {
    run = {
      listId,
      startedAt: Date.now(),
      maxPer: defaultMaxPer,
      total: 0,
      points: 0,
      doneGroups: 0,
    };
  }
  const existing = await db.progress.where('listId').equals(listId).toArray();
  const rowById = new Map(existing.map((r) => [r.itemId, r]));

  const missing: ProgressRow[] = [];
  items.forEach((it, idx) => {
    const row = rowById.get(it.id);
    if (!row) {
      const fresh: ProgressRow = { listId, itemId: it.id, idx, c: [0, 0, 0, 0, 0, 0], done: 0 };
      missing.push(fresh);
      rowById.set(it.id, fresh);
    } else if (row.idx !== idx) {
      row.idx = idx;
    }
  });

  // Recompute aggregates from rows (authoritative).
  let total = 0;
  let points = 0;
  let doneGroups = 0;
  for (const it of items) {
    const dirs = activeDirs(it);
    total += dirs.length * run.maxPer;
    const row = rowById.get(it.id)!;
    let p = 0;
    for (const d of dirs) p += Math.min(row.c[d], run.maxPer);
    points += p;
    const done = dirs.every((d) => row.c[d] >= run!.maxPer);
    row.done = done ? 1 : 0;
    if (done) doneGroups++;
  }
  run.total = total;
  run.points = points;
  run.doneGroups = doneGroups;
  if (doneGroups >= items.length) run.finishedAt ??= Date.now();
  else delete run.finishedAt;

  await db.transaction('rw', db.runs, db.progress, async () => {
    await db.runs.put(run!);
    if (missing.length) await db.progress.bulkPut(missing);
    if (!isNew) {
      // idx may have shifted after a data update; cheap to rewrite all rows only when needed
    }
  });
  return { run, rowById };
}

export async function resetRun(listId: string) {
  await db.transaction('rw', db.runs, db.progress, async () => {
    await db.progress.where('listId').equals(listId).delete();
    await db.runs.delete(listId);
  });
}

export async function resetAll() {
  await db.transaction('rw', db.runs, db.progress, async () => {
    await db.progress.clear();
    await db.runs.clear();
  });
}

export async function persistAnswer(row: ProgressRow, run: RunRow) {
  await db.transaction('rw', db.runs, db.progress, async () => {
    await db.progress.put({ ...row });
    await db.runs.put({ ...run });
  });
}
