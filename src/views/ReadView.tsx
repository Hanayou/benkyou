import { useEffect, useState } from 'preact/hooks';
import { db, type ReadingRow } from '../lib/db';
import { getReaderIndex, type ReaderBook, type ReaderIndex } from '../lib/reader';

export function ReadView({
  active,
  onOpen,
}: {
  active: boolean;
  onOpen(book: ReaderBook, chId: string): void;
}) {
  const [index, setIndex] = useState<ReaderIndex | null>(null);
  const [reading, setReading] = useState<Map<string, ReadingRow>>(new Map());

  useEffect(() => {
    getReaderIndex().then(setIndex).catch(() => setIndex({ version: 0, built: '', books: [] }));
  }, []);

  useEffect(() => {
    if (!active) return;
    db.reading.toArray().then((rows) => setReading(new Map(rows.map((r) => [r.bookId, r]))));
  }, [active]);

  if (!index) return <div class="page-center muted">Loading…</div>;

  return (
    <div class="page">
      <header class="page-head">
        <h1>Read</h1>
      </header>
      {index.books.map((book) => {
        const row = reading.get(book.id);
        const doneQuizzes = Object.keys(row?.quiz ?? {}).length;
        return (
          <section key={book.id}>
            <div class="card book-card">
              <div class="book-head">
                <div class="book-title" lang="ja">
                  {book.title}
                </div>
                <span class="badge">{book.level}</span>
              </div>
              <div class="book-sub muted">
                {book.titleEn} · {book.genre}
              </div>
              <p class="book-tagline" lang="ja">
                {book.tagline}
              </p>
              <div class="book-registers">
                {book.registers.map((r) => (
                  <span class="reg-chip">{r}</span>
                ))}
              </div>
              <div class="book-chars muted">
                {book.characters.map((c) => (
                  <div class="book-char">
                    <b lang="ja">{c.name}</b> — {c.desc}
                  </div>
                ))}
              </div>
            </div>

            <h2 class="section-title">
              Chapters{' '}
              {row?.lastCh ? <span class="muted">· last read {row.lastCh.replace('ch', 'chapter ')}</span> : ''}
              {doneQuizzes > 0 && <span class="muted"> · {doneQuizzes} quiz done</span>}
            </h2>
            <div class="card">
              {book.chapters.map((ch, i) => {
                const best = row?.quiz?.[ch.id];
                const num = parseInt(ch.id.replace(/\D/g, ''), 10) || i + 1;
                return (
                  <button type="button" class="list-row" key={ch.id} onClick={() => onOpen(book, ch.id)}>
                    <div class="list-row-left">
                      <div class="list-row-title">
                        <span class="ch-num">{num}</span>
                        <span lang="ja">{ch.title}</span>
                      </div>
                      <div class="list-row-sub muted">
                        {ch.titleEn} · {ch.sents} sentences · {ch.newWords} new words
                      </div>
                    </div>
                    <div class="list-row-right">
                      {best !== undefined && (
                        <span class={best >= 80 ? 'complete-badge' : 'list-pct'}>{best}%</span>
                      )}
                      <svg class="chev" viewBox="0 0 24 24" width="18" height="18">
                        <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
                      </svg>
                    </div>
                  </button>
                );
              })}
              {book.chapters.length === 0 && (
                <div class="list-row muted">No chapters compiled yet.</div>
              )}
            </div>
          </section>
        );
      })}
      {index.books.length === 0 && <div class="page-center muted">No books yet.</div>}
    </div>
  );
}
