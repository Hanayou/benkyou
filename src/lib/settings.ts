export interface Settings {
  /** Delay before auto-advancing to the next question, in ms. */
  delayMs: number;
  /** How many unfinished groups are kept in rotation at once. */
  wsSize: number;
  /** Default correct-answers-per-direction for newly started lists (locked per list at start). */
  maxPer: number;
}

const KEY = 'benkyou.settings';

export const DEFAULT_SETTINGS: Settings = {
  delayMs: 1000,
  wsSize: 20,
  maxPer: 5,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings just won't persist */
  }
}
