import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { StudyItem, ListMeta } from '../lib/types';
import { getList } from '../lib/data';
import { openRun, persistAnswer, resetRun } from '../lib/db';
import { QuizSession, type Question } from '../lib/engine';
import { loadSettings } from '../lib/settings';
import { Drawer } from '../components/Drawer';
import { ItemDetail } from '../components/ItemDetail';

function promptClass(q: Question): string {
  if (q.prompt === 'k') {
    const len = q.promptText.length;
    return `prompt prompt-k ${len === 1 ? 'sz-xl' : len <= 4 ? 'sz-l' : len <= 8 ? 'sz-m' : 'sz-s'}`;
  }
  return `prompt prompt-${q.prompt}`;
}

function optStyle(label: string, jp: boolean): string {
  const len = label.length;
  let px;
  if (jp) px = len <= 2 ? 32 : len <= 5 ? 26 : len <= 10 ? 21 : len <= 16 ? 18 : 15;
  else px = len <= 14 ? 18 : len <= 24 ? 16 : 14;
  return `font-size:${px}px`;
}

export function QuizView({ list, onExit }: { list: ListMeta; onExit(): void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'done'>('loading');
  const [q, setQ] = useState<Question | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [infoItem, setInfoItem] = useState<StudyItem | null>(null);
  const [stats, setStats] = useState({ right: 0, wrong: 0 });
  const session = useRef<QuizSession | null>(null);
  const itemCount = useRef(0);
  const timer = useRef<number | null>(null);
  const settings = useRef(loadSettings());

  const init = useCallback(async () => {
    setState('loading');
    setChosen(null);
    setQ(null);
    settings.current = loadSettings();
    const items = await getList(list.id);
    itemCount.current = items.length;
    const { run, rowById } = await openRun(list.id, items, settings.current.maxPer);
    const s = new QuizSession(items, rowById, run, settings.current.wsSize);
    session.current = s;
    if (s.listDone()) {
      setState('done');
      return;
    }
    setQ(s.next());
    setState('ready');
    try {
      await navigator.storage?.persist?.();
    } catch {
      /* not critical */
    }
  }, [list.id]);

  useEffect(() => {
    init();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [init]);

  const advance = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const s = session.current;
    if (!s) return;
    if (s.listDone()) {
      setState('done');
      return;
    }
    setChosen(null);
    setQ(s.next());
  }, []);

  const choose = (i: number) => {
    if (chosen !== null || !q) return;
    const s = session.current!;
    const res = s.answer(q, i);
    setChosen(i);
    setInfoItem(q.item);
    setStats((st) => (res.correct ? { ...st, right: st.right + 1 } : { ...st, wrong: st.wrong + 1 }));
    persistAnswer(res.row, s.run).catch(console.error);
    timer.current = window.setTimeout(advance, Math.max(250, settings.current.delayMs));
  };

  const doReset = async () => {
    if (!confirm(`Reset ${list.title}? All progress for this list will be wiped.`)) return;
    await resetRun(list.id);
    await init();
  };

  const run = session.current?.run;
  const pct = run && run.total ? Math.floor((run.points / run.total) * 100) : 0;

  return (
    <div class="quiz">
      <header class="quiz-head">
        <button type="button" class="icon-btn" onClick={onExit} aria-label="Back to lists">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="quiz-title">
          <div class="quiz-title-main">{list.title}</div>
          {run && (
            <div class="quiz-title-sub">
              {run.doneGroups}/{itemCount.current} groups · {pct}%
            </div>
          )}
        </div>
        <div class="quiz-stats">
          <span class="stat-right">✓{stats.right}</span>
          <span class="stat-wrong">✗{stats.wrong}</span>
        </div>
      </header>
      <div class="quiz-bar">
        <div class="quiz-bar-fill" style={`width:${pct}%`} />
      </div>

      {state === 'loading' && <div class="quiz-center muted">Loading…</div>}

      {state === 'done' && (
        <div class="quiz-center">
          <div class="done-panel">
            <div class="done-emoji">🎉</div>
            <h2>List complete!</h2>
            <p class="muted">
              All {itemCount.current} groups maxed out
              {run ? ` — ${run.points} points earned.` : '.'}
            </p>
            <button type="button" class="btn btn-primary" onClick={onExit}>
              Back to lists
            </button>
            <button type="button" class="btn btn-danger-ghost" onClick={doReset}>
              Reset this list
            </button>
          </div>
        </div>
      )}

      {state === 'ready' && q && (
        <>
          <main
            class="quiz-main"
            onClick={chosen !== null ? advance : undefined}
          >
            <div class={promptClass(q)} lang={q.prompt === 'e' ? undefined : 'ja'}>
              {q.promptText.split('\n').map((line) => (
                <div>{line}</div>
              ))}
            </div>
          </main>
          <div class="opts">
            {q.options.map((o, i) => {
              let cls = 'opt';
              if (chosen !== null) {
                if (i === q.correct) cls += ' opt-correct';
                else if (i === chosen) cls += ' opt-wrong';
                else cls += ' opt-dim';
              }
              const jp = q.answer !== 'e';
              return (
                <button
                  type="button"
                  class={cls}
                  style={optStyle(o.label, jp)}
                  lang={jp ? 'ja' : undefined}
                  onClick={() => choose(i)}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          <div class="drawer-zone">
            <Drawer open={drawerOpen} setOpen={setDrawerOpen}>
              {infoItem ? (
                <ItemDetail item={infoItem} />
              ) : (
                <div class="drawer-empty muted">Answer a question to see details here.</div>
              )}
            </Drawer>
          </div>
        </>
      )}
    </div>
  );
}
