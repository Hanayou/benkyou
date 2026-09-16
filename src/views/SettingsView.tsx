import { useEffect, useState } from 'preact/hooks';
import type { ListsIndex } from '../lib/types';
import { db, resetAll, resetRun, type ProgressRow, type RunRow } from '../lib/db';
import { getListsIndex } from '../lib/data';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from '../lib/settings';

const APP_VERSION = '1.0.0';

interface Backup {
  app: 'benkyou';
  v: 1;
  date: string;
  settings: Settings;
  runs: RunRow[];
  progress: ProgressRow[];
}

export function SettingsView({ active }: { active: boolean }) {
  const [s, setS] = useState<Settings>(loadSettings());
  const [index, setIndex] = useState<ListsIndex | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [flash, setFlash] = useState('');

  const refresh = () => db.runs.toArray().then(setRuns);

  useEffect(() => {
    getListsIndex().then(setIndex);
    navigator.storage?.persisted?.().then(setPersisted).catch(() => {});
  }, []);

  useEffect(() => {
    if (active) refresh();
  }, [active]);

  const upd = (patch: Partial<Settings>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
  };

  const note = (msg: string) => {
    setFlash(msg);
    window.setTimeout(() => setFlash(''), 2500);
  };

  const titleOf = (listId: string) => index?.lists.find((l) => l.id === listId)?.title ?? listId;

  const onResetList = async (listId: string) => {
    if (!confirm(`Reset ${titleOf(listId)}? All progress for this list will be wiped.`)) return;
    await resetRun(listId);
    refresh();
  };

  const onResetAll = async () => {
    if (!confirm('Reset ALL study progress? This wipes every list and cannot be undone.')) return;
    await resetAll();
    refresh();
  };

  const onExport = async () => {
    const backup: Backup = {
      app: 'benkyou',
      v: 1,
      date: new Date().toISOString(),
      settings: s,
      runs: await db.runs.toArray(),
      progress: await db.progress.toArray(),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(backup));
      note('Backup copied to clipboard ✓');
    } catch {
      note('Clipboard not available');
    }
  };

  const onImport = async () => {
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      note('Clipboard not available');
      return;
    }
    let backup: Backup;
    try {
      backup = JSON.parse(text);
      if (backup.app !== 'benkyou' || !Array.isArray(backup.runs) || !Array.isArray(backup.progress)) {
        throw new Error('bad');
      }
    } catch {
      note('Clipboard does not contain a Benkyō backup');
      return;
    }
    if (
      !confirm(
        `Restore backup from ${backup.date.slice(0, 10)}? ` +
          `${backup.runs.length} lists, ${backup.progress.length} progress rows. Current progress will be replaced.`
      )
    )
      return;
    await db.transaction('rw', db.runs, db.progress, async () => {
      await db.runs.clear();
      await db.progress.clear();
      await db.runs.bulkPut(backup.runs);
      await db.progress.bulkPut(backup.progress);
    });
    if (backup.settings) {
      const next = { ...DEFAULT_SETTINGS, ...backup.settings };
      setS(next);
      saveSettings(next);
    }
    refresh();
    note('Backup restored ✓');
  };

  return (
    <div class="page">
      <header class="page-head">
        <h1>Settings</h1>
      </header>

      <h2 class="section-title">Quiz</h2>
      <div class="card settings-card">
        <label class="setting">
          <span class="setting-label">
            Auto-advance delay <b>{(s.delayMs / 1000).toFixed(2).replace(/0$/, '')}s</b>
          </span>
          <input
            type="range"
            min="250"
            max="3000"
            step="250"
            value={s.delayMs}
            onInput={(e) => upd({ delayMs: +(e.target as HTMLInputElement).value })}
          />
        </label>
        <label class="setting">
          <span class="setting-label">
            Groups in rotation <b>{s.wsSize}</b>
          </span>
          <input
            type="range"
            min="10"
            max="40"
            step="5"
            value={s.wsSize}
            onInput={(e) => upd({ wsSize: +(e.target as HTMLInputElement).value })}
          />
        </label>
        <label class="setting">
          <span class="setting-label">
            Correct answers per direction <b>{s.maxPer}</b>
          </span>
          <input
            type="range"
            min="1"
            max="10"
            step="1"
            value={s.maxPer}
            onInput={(e) => upd({ maxPer: +(e.target as HTMLInputElement).value })}
          />
          <span class="setting-note muted">
            Locked in when a list is first started — resetting a list picks up the new value.
          </span>
        </label>
      </div>

      <h2 class="section-title">Progress</h2>
      <div class="card settings-card">
        {runs.length === 0 && <div class="setting muted">No lists started yet.</div>}
        {runs.map((r) => (
          <div class="setting setting-row" key={r.listId}>
            <span class="setting-label">
              {titleOf(r.listId)}{' '}
              <span class="muted">
                {r.total ? Math.floor((r.points / r.total) * 100) : 0}% · {r.maxPer}/dir
              </span>
            </span>
            <button type="button" class="btn btn-small btn-danger-ghost" onClick={() => onResetList(r.listId)}>
              Reset
            </button>
          </div>
        ))}
        {runs.length > 0 && (
          <div class="setting">
            <button type="button" class="btn btn-danger-ghost" onClick={onResetAll}>
              Reset all progress
            </button>
          </div>
        )}
      </div>

      <h2 class="section-title">Backup</h2>
      <div class="card settings-card">
        <div class="setting setting-row">
          <span class="setting-label">
            Progress backup
            <span class="setting-note muted">Copies everything as text — paste it back to restore.</span>
          </span>
          <span class="btn-group">
            <button type="button" class="btn btn-small" onClick={onExport}>
              Copy
            </button>
            <button type="button" class="btn btn-small" onClick={onImport}>
              Restore
            </button>
          </span>
        </div>
        {flash && <div class="setting flash">{flash}</div>}
      </div>

      <h2 class="section-title">About</h2>
      <div class="card settings-card about">
        <p>
          <b>
            <span lang="ja">勉強</span> Benkyō
          </b>{' '}
          v{APP_VERSION}
          {index ? ` · data ${index.built}` : ''}
          {persisted !== null && (persisted ? ' · storage persisted ✓' : ' · storage not yet persistent')}
        </p>
        <p class="muted">
          Install on iPhone: open in Safari → Share → <b>Add to Home Screen</b>. Everything works
          offline; progress stays on your device.
        </p>
        <p class="muted about-credits">
          Data: kanji from <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener">KANJIDIC2</a> via{' '}
          <a href="https://github.com/davidluzgouveia/kanji-data" target="_blank" rel="noopener">kanji-data</a> (CC BY-SA);
          vocabulary from <a href="https://www.tanos.co.uk/jlpt/" target="_blank" rel="noopener">Jonathan Waller's JLPT lists</a> via{' '}
          <a href="https://github.com/jamsinclair/open-anki-jlpt-decks" target="_blank" rel="noopener">open-anki-jlpt-decks</a> (CC BY);
          stroke order from <a href="https://kanjivg.tagaini.net/" target="_blank" rel="noopener">KanjiVG</a> (CC BY-SA 3.0);
          example sentences from the <a href="https://www.edrdg.org/wiki/index.php/Tanaka_Corpus" target="_blank" rel="noopener">Tanaka Corpus</a> (CC BY).
          JLPT level assignments are unofficial community estimates.
        </p>
      </div>
    </div>
  );
}
