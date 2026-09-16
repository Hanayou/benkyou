# 勉強 Benkyō

A simple, fast JLPT kanji & vocabulary drill app — an installable offline PWA.
No accounts, no server: all progress lives on your device.

## What it does

- **10 lists**: N5→N1 Kanji and N5→N1 Vocabulary.
- **Classic drill loop**: each item ("group") is quizzed in 6 directions —
  kanji↔yomi, kanji↔English, yomi↔English — as 4-choice questions. Each correct
  answer scores a point for that direction; there is no penalty for mistakes.
  A direction maxes out after N correct answers (default 5, configurable).
- **Working set**: only the first ~20 unfinished groups rotate at once, so new
  material repeats frequently. Maxed-out groups retire and the next group is
  pulled in. When every group is maxed, the list is complete.
- **Locked rules per list**: the answers-per-direction setting is frozen into a
  list the moment you start it; only resetting that list picks up a new value.
- **Info drawer**: swipe up from the bottom of the quiz for stroke-order
  animations (KanjiVG), readings, meanings, example sentences, and related
  vocabulary for whatever you just answered. Stays out of the way otherwise.
- **Search tab**: search every list by kanji, kana, romaji, or English.
- **Settings**: auto-advance delay, rotation size, per-direction target,
  per-list reset, and clipboard backup/restore of all progress.

## Development

```bash
npm install
npm run data:fetch   # download source dictionaries into .data-cache/
npm run data:build   # build public/data/ (lists, stroke shards, examples)
npm run icons        # regenerate icons from KanjiVG strokes
npm run dev          # dev server
npm test             # quiz-engine unit tests
npm run build        # production build (dist/)
```

`public/data/` is committed, so clones can build without re-fetching sources.

## Deploying

Pushes to `main` deploy to GitHub Pages via `.github/workflows/deploy.yml`
(build with `BASE_PATH=/<repo-name>/`). Any static host works — set `BASE_PATH`
to the URL prefix the app is served under.

## Installing on iPhone

Open the deployed URL in Safari → Share → **Add to Home Screen**. The app
precaches everything (~6 MB) and works fully offline. Progress is stored in
IndexedDB; use Settings → Backup to copy it elsewhere.

## Data sources & licenses

App code is MIT. The bundled study data is built from:

| Source | Used for | License |
| --- | --- | --- |
| [KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) (via [kanji-data](https://github.com/davidluzgouveia/kanji-data)) | kanji readings/meanings, JLPT levels | CC BY-SA 4.0 (EDRDG) |
| [Jonathan Waller's JLPT lists](https://www.tanos.co.uk/jlpt/) (via [open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks)) | vocabulary lists | CC BY |
| [KanjiVG](https://kanjivg.tagaini.net/) | stroke-order diagrams | CC BY-SA 3.0 |
| [Tanaka Corpus](https://www.edrdg.org/wiki/index.php/Tanaka_Corpus) | example sentences | CC BY |

JLPT level assignments are unofficial community estimates — the JLPT has not
published official lists since 2010.
