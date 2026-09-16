import { useEffect, useRef, useState } from 'preact/hooks';
import { getStrokes, type StrokeData } from '../lib/strokes';

/**
 * Animated stroke-order diagram (KanjiVG). Tap to replay.
 */
export function StrokeOrder({ char, size = 94 }: { char: string; size?: number }) {
  const [data, setData] = useState<StrokeData | 'missing' | null>(null);
  const fgRef = useRef<SVGGElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    let alive = true;
    setData(null);
    getStrokes(char).then((d) => {
      if (alive) setData(d ?? 'missing');
    });
    return () => {
      alive = false;
    };
  }, [char]);

  const clearTimers = () => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  };

  const play = () => {
    const g = fgRef.current;
    if (!g) return;
    clearTimers();
    const paths = Array.from(g.querySelectorAll('path'));
    let at = 80;
    for (const p of paths) {
      const len = p.getTotalLength();
      p.style.transition = 'none';
      p.style.strokeDasharray = `${len}`;
      p.style.strokeDashoffset = `${len}`;
      const dur = Math.max(200, len * 4.5);
      timers.current.push(
        window.setTimeout(() => {
          p.style.transition = `stroke-dashoffset ${dur}ms ease-out`;
          p.style.strokeDashoffset = '0';
        }, at)
      );
      at += dur + 100;
    }
  };

  useEffect(() => {
    if (data && data !== 'missing') {
      timers.current.push(window.setTimeout(play, 30));
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <button
      type="button"
      class="stroke-box"
      style={{ width: `${size}px`, height: `${size}px` }}
      onClick={play}
      aria-label={`Stroke order for ${char} — tap to replay`}
    >
      {data === 'missing' ? (
        <span class="stroke-fallback" lang="ja">
          {char}
        </span>
      ) : data ? (
        <svg viewBox="0 0 109 109" aria-hidden="true">
          <line class="so-guide" x1="54.5" y1="2" x2="54.5" y2="107" />
          <line class="so-guide" x1="2" y1="54.5" x2="107" y2="54.5" />
          <g class="so-bg">
            {data.p.map((d) => (
              <path d={d} />
            ))}
          </g>
          <g class="so-fg" ref={fgRef}>
            {data.p.map((d) => (
              <path d={d} />
            ))}
          </g>
          <g class="so-num">
            {data.n.map(([x, y], i) => (
              <text x={x} y={y}>
                {i + 1}
              </text>
            ))}
          </g>
        </svg>
      ) : null}
    </button>
  );
}
