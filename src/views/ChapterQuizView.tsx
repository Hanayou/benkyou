import { useEffect, useRef, useState } from 'preact/hooks';
import { db } from '../lib/db';
import { loadSettings } from '../lib/settings';
import {
  getChapter,
  getGlossary,
  type GlossEntry,
  type ReaderBook,
  type ReaderChapter,
} from '../lib/reader';

interface Q {
  prompt: string;
  promptJa: boolean;
  cloze?: boolean;
  options: string[];
  optionsJa: boolean;
  correct: number;
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickDistinct<T>(pool: T[], n: number, label: (x: T) => string, exclude: Set<string>): T[] {
  const out: T[] = [];
  const used = new Set(exclude);
  for (const item of shuffle(pool)) {
    const l = label(item);
    if (used.has(l)) continue;
    used.add(l);
    out.push(item);
    if (out.length >= n) break;
  }
  return out;
}

function buildQuestions(ch: ReaderChapter, gloss: Record<string, GlossEntry>): Q[] {
  const qs: Q[] = [];
  const vocab = ch.vocab;
  const newWords = shuffle(vocab.filter((v) => v.n));
  const pool = newWords.length >= 8 ? newWords : shuffle(vocab);
  const take = pool.slice(0, 9);

  take.forEach((v, i) => {
    const mode = i % 3; // rotate question types
    if (mode === 0) {
      const ds = pickDistinct(vocab, 3, (x) => x.g, new Set([v.g]));
      const options = shuffle([v, ...ds].map((x) => x.g));
      qs.push({ prompt: v.t, promptJa: true, options, optionsJa: false, correct: options.indexOf(v.g) });
    } else if (mode === 1) {
      const ds = pickDistinct(vocab, 3, (x) => x.t, new Set([v.t]));
      const options = shuffle([v, ...ds].map((x) => x.t));
      qs.push({ prompt: v.g, promptJa: false, options, optionsJa: true, correct: options.indexOf(v.t) });
    } else {
      const ds = pickDistinct(vocab, 3, (x) => x.r, new Set([v.r]));
      if (ds.length < 3) return;
      const options = shuffle([v, ...ds].map((x) => x.r));
      qs.push({ prompt: v.t, promptJa: true, options, optionsJa: true, correct: options.indexOf(v.r) });
    }
  });

  const grammarPool = ch.grammar.filter((k) => gloss[k]);
  for (const key of ch.focus) {
    const refs = ch.clozeRefs[key] ?? [];
    if (refs.length) {
      const [pi, si] = refs[Math.floor(Math.random() * refs.length)];
      const sent = ch.paras[pi]?.s[si];
      if (sent) {
        const text = sent.t
          .map((t) => (typeof t !== 'string' && t[1] === key ? '［＿＿］' : typeof t === 'string' ? t : t[0]))
          .join('');
        const ds = pickDistinct(
          grammarPool.filter((k) => k !== key),
          3,
          (k) => k,
          new Set([key])
        );
        if (ds.length === 3) {
          const options = shuffle([key, ...ds]);
          qs.push({ prompt: text, promptJa: true, cloze: true, options, optionsJa: true, correct: options.indexOf(key) });
        }
      }
    }
    const ds = pickDistinct(
      grammarPool.filter((k) => k !== key && gloss[k].short !== gloss[key].short),
      3,
      (k) => gloss[k].short,
      new Set([gloss[key].short])
    );
    if (ds.length === 3) {
      const options = shuffle([gloss[key].short, ...ds.map((k) => gloss[k].short)]);
      qs.push({ prompt: key, promptJa: true, options, optionsJa: false, correct: options.indexOf(gloss[key].short) });
    }
  }

  return shuffle(qs);
}

export function ChapterQuizView({
  book,
  chId,
  onExit,
}: {
  book: ReaderBook;
  chId: string;
  onExit(): void;
}) {
  const [qs, setQs] = useState<Q[] | null>(null);
  const [at, setAt] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [right, setRight] = useState(0);
  const [done, setDone] = useState(false);
  const timer = useRef<number | null>(null);
  const settings = useRef(loadSettings());

  useEffect(() => {
    Promise.all([getChapter(book.id, chId), getGlossary()]).then(([ch, gloss]) =>
      setQs(buildQuestions(ch, gloss))
    );
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [book.id, chId]);

  const finish = async (score: number, total: number) => {
    setDone(true);
    const pct = Math.round((score / total) * 100);
    try {
      const row = (await db.reading.get(book.id)) ?? { bookId: book.id, quiz: {} };
      row.quiz = { ...row.quiz, [chId]: Math.max(row.quiz[chId] ?? 0, pct) };
      await db.reading.put(row);
    } catch {
      /* non-fatal */
    }
  };

  const choose = (i: number) => {
    if (chosen !== null || !qs) return;
    setChosen(i);
    const correct = i === qs[at].correct;
    const newRight = right + (correct ? 1 : 0);
    if (correct) setRight(newRight);
    timer.current = window.setTimeout(() => {
      setChosen(null);
      if (at + 1 >= qs.length) finish(newRight, qs.length);
      else setAt(at + 1);
    }, Math.max(250, settings.current.delayMs));
  };

  const q = qs?.[at];
  const chMeta = book.chapters.find((c) => c.id === chId);

  return (
    <div class="quiz">
      <header class="quiz-head">
        <button type="button" class="icon-btn" onClick={onExit} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="quiz-title">
          <div class="quiz-title-main" lang="ja">
            {chMeta?.title} — 復習
          </div>
          <div class="quiz-title-sub">
            {qs ? `${Math.min(at + 1, qs.length)}/${qs.length}` : '…'} · ✓{right}
          </div>
        </div>
      </header>
      <div class="quiz-bar">
        <div class="quiz-bar-fill" style={`width:${qs ? (at / qs.length) * 100 : 0}%`} />
      </div>

      {!qs ? (
        <div class="quiz-center muted">Building quiz…</div>
      ) : done ? (
        <div class="quiz-center">
          <div class="done-panel">
            <div class="done-emoji">{right / qs.length >= 0.8 ? '🎉' : '📖'}</div>
            <h2>
              {right}/{qs.length}
            </h2>
            <p class="muted">
              {right / qs.length >= 0.8
                ? 'Solid. On to the next chapter.'
                : 'Worth one more read of the tricky spots.'}
            </p>
            <button type="button" class="btn btn-primary" onClick={onExit}>
              Back to the book
            </button>
          </div>
        </div>
      ) : q ? (
        <>
          <main class="quiz-main">
            <div
              class={`prompt ${q.cloze ? 'prompt-cloze' : q.promptJa ? 'prompt-y' : 'prompt-e'}`}
              lang={q.promptJa ? 'ja' : undefined}
            >
              <div>{q.prompt}</div>
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
              const len = o.length;
              const px = q.optionsJa ? (len <= 5 ? 24 : len <= 10 ? 20 : 16) : len <= 18 ? 17 : 14;
              return (
                <button
                  type="button"
                  class={cls}
                  style={`font-size:${px}px`}
                  lang={q.optionsJa ? 'ja' : undefined}
                  onClick={() => choose(i)}
                >
                  {o}
                </button>
              );
            })}
          </div>
          <div class="drawer-zone" />
        </>
      ) : null}
    </div>
  );
}
