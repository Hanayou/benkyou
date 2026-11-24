import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { db } from '../lib/db';
import {
  getChapter,
  getGlossary,
  sentText,
  type GlossEntry,
  type RSent,
  type RToken,
  type ReaderBook,
  type ReaderChapter,
  type ReaderCharacter,
} from '../lib/reader';

type Popover =
  | { kind: 'v'; t: string; r: string; g: string; b?: string; sent: RSent }
  | { kind: 'g'; key: string; entry: GlossEntry; focus: boolean; sent: RSent }
  | { kind: 'sp'; char: ReaderCharacter };

interface ReaderPrefs {
  split: boolean;
  furi: boolean;
}

function loadPrefs(): ReaderPrefs {
  try {
    return { split: false, furi: false, ...JSON.parse(localStorage.getItem('benkyou.reader') ?? '{}') };
  } catch {
    return { split: false, furi: false };
  }
}

export function ReaderView({
  book,
  chId,
  onExit,
  onQuiz,
  onChapter,
}: {
  book: ReaderBook;
  chId: string;
  onExit(): void;
  onQuiz(): void;
  onChapter(chId: string): void;
}) {
  const [ch, setCh] = useState<ReaderChapter | null>(null);
  const [gloss, setGloss] = useState<Record<string, GlossEntry> | null>(null);
  const [pop, setPop] = useState<Popover | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs());
  const [pct, setPct] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const posKey = `benkyou.rpos.${book.id}/${chId}`;

  // Long chapters: remember the paragraph you were on and come back to it.
  useEffect(() => {
    const body = bodyRef.current;
    if (!ch || !body) return;
    let saved = 0;
    try {
      saved = parseInt(localStorage.getItem(posKey) ?? '0', 10) || 0;
    } catch {
      /* fine */
    }
    const el = body.querySelector<HTMLElement>(`[data-pi="${saved}"]`);
    body.scrollTop = saved > 0 && el ? el.offsetTop - 12 : 0;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // progress = how far through the story (the review section doesn't count)
        const end = body.querySelector<HTMLElement>('.review')?.offsetTop ?? body.scrollHeight;
        const max = end - body.clientHeight;
        setPct(max > 0 ? Math.min(100, Math.round((body.scrollTop / max) * 100)) : 100);
        const paras = body.querySelectorAll<HTMLElement>('[data-pi]');
        let cur = paras.length ? Number(paras[paras.length - 1].dataset.pi) : 0;
        for (const p of paras) {
          if (p.offsetTop + p.offsetHeight > body.scrollTop + 12) {
            cur = Number(p.dataset.pi);
            break;
          }
        }
        try {
          localStorage.setItem(posKey, String(cur));
        } catch {
          /* fine */
        }
      });
    };
    onScroll();
    body.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      body.removeEventListener('scroll', onScroll);
    };
  }, [ch, posKey]);

  useEffect(() => {
    setCh(null);
    setPop(null);
    Promise.all([getChapter(book.id, chId), getGlossary()]).then(([c, g]) => {
      setCh(c);
      setGloss(g);
    });
    db.reading
      .get(book.id)
      .then((row) => db.reading.put({ bookId: book.id, quiz: {}, ...row, lastCh: chId }))
      .catch(() => {});
  }, [book.id, chId]);

  const upd = (patch: Partial<ReaderPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    try {
      localStorage.setItem('benkyou.reader', JSON.stringify(next));
    } catch {
      /* fine */
    }
  };

  const chIndex = book.chapters.findIndex((c) => c.id === chId);
  const nextCh = book.chapters[chIndex + 1];

  const focusSet = useMemo(() => new Set(ch?.focus ?? []), [ch]);

  const renderToken = (tok: RToken, sent: RSent) => {
    if (typeof tok === 'string') return tok;
    const [text, ref] = tok;
    if (typeof ref === 'number') {
      const v = ch!.vocab[ref];
      return (
        <button
          type="button"
          class="tk"
          onClick={(e) => {
            e.stopPropagation();
            setPop({ kind: 'v', t: v.t, r: v.r, g: v.g, b: v.b, sent });
          }}
        >
          {prefs.furi ? (
            <ruby>
              {text}
              <rt>{v.r}</rt>
            </ruby>
          ) : (
            text
          )}
        </button>
      );
    }
    const entry = gloss![ref];
    const isFocus = focusSet.has(ref);
    return (
      <button
        type="button"
        class={`tk tk-g${isFocus ? ' tk-f' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setPop({ kind: 'g', key: ref, entry, focus: isFocus, sent });
        }}
      >
        {text}
      </button>
    );
  };

  const speakerChip = (sp: string) => {
    const char = book.characters.find((c) => sp.includes(c.name));
    return (
      <button
        type="button"
        class="sp-chip"
        lang="ja"
        onClick={() => char && setPop({ kind: 'sp', char })}
      >
        {sp}
      </button>
    );
  };

  return (
    <div class="reader" onClick={() => setPop(null)}>
      <header class="quiz-head">
        <button type="button" class="icon-btn" onClick={onExit} aria-label="Back">
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </button>
        <div class="quiz-title">
          <div class="quiz-title-main" lang="ja">
            {ch?.title ?? '…'}
          </div>
          <div class="quiz-title-sub">
            {book.titleEn} · chapter {parseInt(chId.replace(/\D/g, ''), 10) || chIndex + 1}
          </div>
        </div>
        <div class="reader-tools">
          <button
            type="button"
            class={`tool-btn${prefs.furi ? ' on' : ''}`}
            onClick={() => upd({ furi: !prefs.furi })}
            aria-pressed={prefs.furi}
            title="Furigana"
            lang="ja"
          >
            ふり
          </button>
          <button
            type="button"
            class={`tool-btn${prefs.split ? ' on' : ''}`}
            onClick={() => upd({ split: !prefs.split })}
            aria-pressed={prefs.split}
            title="Side-by-side English"
          >
            JP∣EN
          </button>
        </div>
      </header>

      <div class="rprogress" style={`width:${pct}%`} />
      <div class={`reader-body${prefs.furi ? ' with-furi' : ''}`} ref={bodyRef}>
        {!ch || !gloss ? (
          <div class="page-center muted">Loading…</div>
        ) : (
          <>
            {ch.paras.map((para, pi) =>
              para.hr ? (
                <div class="rbreak" data-pi={pi} aria-hidden="true">
                  ◇
                </div>
              ) : (
              <div class="rpara" data-pi={pi}>
                {para.sp && speakerChip(para.sp)}
                {prefs.split ? (
                  <div class="rsplit">
                    <p class="rjp" lang="ja">
                      {para.s.map((sent) => (
                        <span class="rsent">{sent.t.map((tok) => renderToken(tok, sent))}</span>
                      ))}
                    </p>
                    <p class="ren">{para.s.map((sent) => sent.en).join(' ')}</p>
                  </div>
                ) : (
                  <p class="rjp" lang="ja">
                    {para.s.map((sent) => (
                      <span class="rsent">{sent.t.map((tok) => renderToken(tok, sent))}</span>
                    ))}
                  </p>
                )}
              </div>
              )
            )}

            <section class="review">
              <h3 class="section-title">
                復習 · Review — {ch.vocab.filter((v) => v.n).length} new words,{' '}
                {ch.focus.length} focus patterns
              </h3>
              <div class="card review-grammar">
                {ch.focus.map((key) => (
                  <div class="rg-row">
                    <span class="rg-key" lang="ja">
                      {key}
                    </span>
                    <span class="rg-body">
                      <b>{gloss[key]?.short}</b>
                      {gloss[key]?.note && <span class="muted"> — {gloss[key].note}</span>}
                    </span>
                    {gloss[key]?.jlpt && <span class="badge">{gloss[key].jlpt}</span>}
                  </div>
                ))}
                {ch.grammar
                  .filter((k) => !focusSet.has(k) && gloss[k]?.jlpt)
                  .map((k) => (
                    <div class="rg-row rg-minor">
                      <span class="rg-key" lang="ja">
                        {k}
                      </span>
                      <span class="rg-body muted">{gloss[k].short}</span>
                      <span class="badge">{gloss[k].jlpt}</span>
                    </div>
                  ))}
              </div>
              <details class="card review-vocab" open={ch.vocab.filter((v) => v.n).length <= 60}>
                <summary class="rv-sum">New words ({ch.vocab.filter((v) => v.n).length})</summary>
                {ch.vocab
                  .filter((v) => v.n)
                  .map((v) => (
                    <div class="rv-row">
                      <span class="rv-w" lang="ja">
                        {v.t}
                      </span>
                      <span class="rv-r muted" lang="ja">
                        {v.r}
                      </span>
                      <span class="rv-g">{v.g}</span>
                    </div>
                  ))}
              </details>
              <div class="review-actions">
                <button type="button" class="btn btn-primary" onClick={onQuiz}>
                  Chapter quiz
                </button>
                {nextCh && (
                  <button type="button" class="btn" onClick={() => onChapter(nextCh.id)}>
                    Next: <span lang="ja">{nextCh.title}</span>
                  </button>
                )}
              </div>
            </section>
          </>
        )}
      </div>

      {pop && (
        <div class="tkpop" onClick={(e) => e.stopPropagation()}>
          <button type="button" class="tkpop-close icon-btn" onClick={() => setPop(null)} aria-label="Close">
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            </svg>
          </button>
          {pop.kind === 'v' && (
            <>
              <div class="tkpop-head">
                <span class="tkpop-word" lang="ja">
                  {pop.t}
                </span>
                <span class="tkpop-read" lang="ja">
                  {pop.r}
                </span>
              </div>
              <div class="tkpop-gloss">{pop.g}</div>
              {pop.b && <div class="tkpop-base muted">{pop.b}</div>}
            </>
          )}
          {pop.kind === 'g' && (
            <>
              <div class="tkpop-head">
                <span class="tkpop-word" lang="ja">
                  {pop.key}
                </span>
                {pop.entry.jlpt && <span class="badge">{pop.entry.jlpt}</span>}
                {pop.focus && <span class="badge badge-vocab">chapter focus</span>}
              </div>
              <div class="tkpop-gloss">{pop.entry.short}</div>
              {pop.entry.note && <div class="tkpop-base muted">{pop.entry.note}</div>}
            </>
          )}
          {pop.kind === 'sp' && (
            <>
              <div class="tkpop-head">
                <span class="tkpop-word" lang="ja">
                  {pop.char.name}
                </span>
                <span class="tkpop-read" lang="ja">
                  {pop.char.kana}
                </span>
              </div>
              <div class="tkpop-gloss">{pop.char.desc}</div>
              <div class="tkpop-base muted">Speech style: {pop.char.register}</div>
            </>
          )}
          {pop.kind !== 'sp' && (
            <div class="tkpop-sent">
              <div class="tkpop-sent-ja muted" lang="ja">
                {sentText(pop.sent)}
              </div>
              <div class="tkpop-sent-en">{pop.sent.en}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
