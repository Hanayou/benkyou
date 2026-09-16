import { useEffect, useState } from 'preact/hooks';
import type { ListMeta, ListsIndex } from '../lib/types';
import { db, type RunRow } from '../lib/db';
import { getListsIndex } from '../lib/data';

function ListRow({ list, run, onOpen }: { list: ListMeta; run?: RunRow; onOpen(l: ListMeta): void }) {
  const pct = run && run.total ? Math.floor((run.points / run.total) * 100) : 0;
  const finished = !!run?.finishedAt;
  return (
    <button type="button" class="list-row" onClick={() => onOpen(list)}>
      <div class="list-row-left">
        <div class="list-row-title">{list.title}</div>
        <div class="list-row-sub muted">
          {run ? `${run.doneGroups}/${list.count} groups` : `${list.count} groups`}
        </div>
      </div>
      <div class="list-row-right">
        {finished ? (
          <span class="complete-badge">✓ Complete</span>
        ) : run ? (
          <>
            <span class="list-pct">{pct}%</span>
            <span class="mini-bar">
              <span class="mini-bar-fill" style={`width:${pct}%`} />
            </span>
          </>
        ) : (
          <span class="muted list-new">Not started</span>
        )}
        <svg class="chev" viewBox="0 0 24 24" width="18" height="18">
          <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </div>
    </button>
  );
}

export function ListsView({ active, onOpen }: { active: boolean; onOpen(l: ListMeta): void }) {
  const [index, setIndex] = useState<ListsIndex | null>(null);
  const [runs, setRuns] = useState<Map<string, RunRow>>(new Map());

  useEffect(() => {
    getListsIndex().then(setIndex);
  }, []);

  useEffect(() => {
    if (!active) return;
    db.runs.toArray().then((rows) => setRuns(new Map(rows.map((r) => [r.listId, r]))));
  }, [active]);

  if (!index) return <div class="page-center muted">Loading…</div>;

  const kanji = index.lists.filter((l) => l.kind === 'kanji');
  const vocab = index.lists.filter((l) => l.kind === 'vocab');

  return (
    <div class="page">
      <header class="page-head">
        <h1>
          <span lang="ja">勉強</span> <span class="page-head-sub">Benkyō</span>
        </h1>
      </header>
      <section>
        <h2 class="section-title">Kanji</h2>
        <div class="card">
          {kanji.map((l) => (
            <ListRow key={l.id} list={l} run={runs.get(l.id)} onOpen={onOpen} />
          ))}
        </div>
      </section>
      <section>
        <h2 class="section-title">Vocabulary</h2>
        <div class="card">
          {vocab.map((l) => (
            <ListRow key={l.id} list={l} run={runs.get(l.id)} onOpen={onOpen} />
          ))}
        </div>
      </section>
    </div>
  );
}
