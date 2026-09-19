import { useEffect, useRef, useState } from 'preact/hooks';
import type { ListMeta, StudyItem } from '../lib/types';
import { db, resetRun, type ProgressRow, type RunRow } from '../lib/db';
import { getList } from '../lib/data';
import { activeDirs } from '../lib/facets';
import { loadSettings } from '../lib/settings';
import { DetailModal } from '../components/DetailModal';

/** Column order matches DIRS in facets.ts: 字=written form, 読=yomi, 英=english. */
const DIR_LABELS = ['字→読', '読→字', '字→英', '英→字', '読→英', '英→読'];

const CHUNK = 150;

export function ListDetailView({
  list,
  active,
  onStart,
  onExit,
}: {
  list: ListMeta;
  active: boolean;
  onStart(): void;
  onExit(): void;
}) {
  const [items, setItems] = useState<StudyItem[] | null>(null);
  const [run, setRun] = useState<RunRow | null>(null);
  const [rows, setRows] = useState<Map<string, ProgressRow>>(new Map());
  const [visible, setVisible] = useState(CHUNK);
  const [detail, setDetail] = useState<StudyItem | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const settings = useRef(loadSettings());

  useEffect(() => setVisible(CHUNK), [list.id]);

  // Read-only load — a run is only created when the quiz actually starts.
  useEffect(() => {
    if (!active) return;
    let alive = true;
    (async () => {
      settings.current = loadSettings();
      const [its, r, prog] = await Promise.all([
        getList(list.id),
        db.runs.get(list.id),
        db.progress.where('listId').equals(list.id).toArray(),
      ]);
      if (!alive) return;
      setItems(its);
      setRun(r ?? null);
      setRows(new Map(prog.map((p) => [p.itemId, p])));
    })();
    return () => {
      alive = false;
    };
  }, [list.id, active]);

  // Long lists render in chunks as you scroll (N1 vocab is ~2,700 rows).
  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) setVisible((v) => v + CHUNK);
      },
      { rootMargin: '900px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [items, visible]);

  const max = run?.maxPer ?? settings.current.maxPer;
  const total = items?.length ?? list.count;
  const doneCount = items ? items.reduce((s, it) => s + (rows.get(it.id)?.done ? 1 : 0), 0) : 0;
  const pct = run && run.total ? Math.floor((run.points / run.total) * 100) : 0;
  const complete = !!items && !!run && doneCount >= items.length;

  const rotation = new Set<string>();
  if (items && !complete) {
    for (const it of items) {
      if (rotation.size >= settings.current.wsSize) break;
      if (!rows.get(it.id)?.done) rotation.add(it.id);
    }
  }

  const doReset = async () => {
    if (!confirm(`Reset ${list.title}? All progress for this list will be wiped.`)) return;
    await resetRun(list.id);
    setRun(null);
    setRows(new Map());
  };

  return (
    <div class="ld">
      <header class="quiz-head">
        <button type="button" class="icon-btn" onClick={onExit} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="quiz-title">
          <div class="quiz-title-main">{list.title}</div>
          <div class="quiz-title-sub">
            {doneCount}/{total} groups · {pct}% · {max} per direction
          </div>
        </div>
      </header>
      <div class="quiz-bar">
        <div class="quiz-bar-fill" style={`width:${pct}%`} />
      </div>

      <div class="ld-actions">
        {complete ? (
          <>
            <span class="ld-complete">🎉 List complete!</span>
            <button type="button" class="btn btn-small btn-danger-ghost" onClick={doReset}>
              Reset
            </button>
          </>
        ) : (
          <button type="button" class="btn btn-primary btn-start" onClick={onStart}>
            {run ? 'Continue studying' : 'Start studying'}
          </button>
        )}
      </div>

      <div class="ld-scroll">
        {!items ? (
          <div class="page-center muted">Loading…</div>
        ) : (
          <>
            <div class="ld-dirhead" aria-hidden="true">
              <span class="ld-legend">{rotation.size > 0 ? 'in rotation' : ''}</span>
              {DIR_LABELS.map((l) => (
                <span lang="ja">{l}</span>
              ))}
            </div>
            <div class="ld-rows">
              {items.slice(0, visible).map((it) => {
                const row = rows.get(it.id);
                const dirs = activeDirs(it);
                const done = row?.done === 1;
                return (
                  <button
                    type="button"
                    class={`ld-row${done ? ' ld-done' : ''}`}
                    key={it.id}
                    onClick={() => setDetail(it)}
                  >
                    <span class="ld-left">
                      {rotation.has(it.id) && <span class="ld-dot" />}
                      <span class="ld-text" lang="ja">
                        {it.text}
                      </span>
                      <span class="ld-kana" lang="ja">
                        {it.kind === 'kanji'
                          ? it.yomiOption
                          : it.hasKanjiFacet
                            ? it.kana
                            : it.enShort}
                      </span>
                    </span>
                    {[0, 1, 2, 3, 4, 5].map((d) => {
                      const on = dirs.includes(d);
                      const v = Math.min(row?.c[d] ?? 0, max);
                      const p = on && max ? (v / max) * 100 : 0;
                      return (
                        <span
                          class={`ld-cell${!on ? ' ld-off' : v >= max ? ' ld-full' : ''}`}
                          style={
                            on && v > 0 && v < max
                              ? `background:linear-gradient(to top, var(--cell-fill) ${p}%, transparent ${p}%)`
                              : undefined
                          }
                        >
                          {on ? v : '·'}
                        </span>
                      );
                    })}
                  </button>
                );
              })}
            </div>
            {visible < items.length && (
              <div ref={sentinel} class="ld-sentinel muted">
                …
              </div>
            )}
          </>
        )}
      </div>

      {detail && <DetailModal item={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
