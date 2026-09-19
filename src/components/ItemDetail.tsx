import { useEffect, useRef, useState } from 'preact/hooks';
import type { StudyItem } from '../lib/types';
import { getAllItems } from '../lib/data';
import { isDrawable } from '../lib/strokes';
import { StrokeOrder } from './StrokeOrder';

function Highlighted({ text, hl }: { text: string; hl: string }) {
  if (!hl || !text.includes(hl)) return <span>{text}</span>;
  const parts = text.split(hl);
  return (
    <span>
      {parts.map((p, i) => (
        <>
          {p}
          {i < parts.length - 1 && <mark>{hl}</mark>}
        </>
      ))}
    </span>
  );
}

/** Full info panel for one item — used by the quiz drawer and search. */
export function ItemDetail({ item }: { item: StudyItem }) {
  const [related, setRelated] = useState<StudyItem[]>([]);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // content swaps in place while the drawer stays open — show the new item from the top
    if (root.current?.parentElement) root.current.parentElement.scrollTop = 0;
    setRelated([]);
    if (item.kind !== 'kanji') return;
    let alive = true;
    getAllItems().then((all) => {
      if (!alive) return;
      const words = all
        .filter((it) => it.kind === 'vocab' && it.text.includes(item.text))
        .sort((a, b) => b.level - a.level || a.text.length - b.text.length)
        .slice(0, 6);
      setRelated(words);
    });
    return () => {
      alive = false;
    };
  }, [item]);

  const strokeChars = [...new Set([...item.text])].filter(isDrawable);

  return (
    <div class="detail" ref={root}>
      <div class="detail-head">
        <div class="detail-main">
          <div class="detail-text" lang="ja">
            {item.text}
          </div>
          <div class="detail-sub">
            {item.kind === 'vocab' ? (
              <div class="detail-kana" lang="ja">
                {item.kana}
              </div>
            ) : (
              <>
                {item.kun.length > 0 && (
                  <div class="detail-yomi">
                    <span class="yomi-label">訓</span>
                    <span lang="ja">{item.kun.join('・')}</span>
                  </div>
                )}
                {item.on.length > 0 && (
                  <div class="detail-yomi">
                    <span class="yomi-label">音</span>
                    <span lang="ja">{item.on.join('・')}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <span class="badge">
          N{item.level} {item.kind === 'kanji' ? 'kanji' : 'vocab'}
        </span>
      </div>

      <p class="detail-en">{item.en.join(', ')}</p>

      {strokeChars.length > 0 && (
        <section class="detail-section">
          <h3>Stroke order</h3>
          <div class="stroke-row">
            {strokeChars.map((c) => (
              <StrokeOrder key={item.id + c} char={c} />
            ))}
          </div>
        </section>
      )}

      {item.ex.length > 0 && (
        <section class="detail-section">
          <h3>Examples</h3>
          {item.ex.map(([ja, en, hl]) => (
            <div class="example">
              <div class="example-ja" lang="ja">
                <Highlighted text={ja} hl={hl} />
              </div>
              <div class="example-en">{en}</div>
            </div>
          ))}
        </section>
      )}

      {related.length > 0 && (
        <section class="detail-section">
          <h3>
            Words using <span lang="ja">{item.text}</span>
          </h3>
          {related.map((w) => (
            <div class="related-row">
              <span class="related-word" lang="ja">
                {w.text}
              </span>
              <span class="related-kana" lang="ja">
                {w.kana}
              </span>
              <span class="related-en">{w.enShort}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
