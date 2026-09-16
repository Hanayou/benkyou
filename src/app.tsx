import { useEffect, useState } from 'preact/hooks';
import type { ListMeta } from './lib/types';
import { ListsView } from './views/ListsView';
import { SearchView } from './views/SearchView';
import { SettingsView } from './views/SettingsView';
import { QuizView } from './views/QuizView';

type Tab = 'study' | 'search' | 'settings';

function TabIcon({ tab }: { tab: Tab }) {
  switch (tab) {
    case 'study':
      return (
        <svg viewBox="0 0 24 24" width="24" height="24">
          <rect x="4" y="3.5" width="16" height="17" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      );
    case 'search':
      return (
        <svg viewBox="0 0 24 24" width="24" height="24">
          <circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      );
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" width="24" height="24">
          <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8" />
          <path
            d="M12 3v2.6M12 18.4V21M21 12h-2.6M5.6 12H3M18.4 5.6l-1.9 1.9M7.5 16.5l-1.9 1.9M18.4 18.4l-1.9-1.9M7.5 7.5L5.6 5.6"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
          />
        </svg>
      );
  }
}

const TABS: { id: Tab; label: string }[] = [
  { id: 'study', label: 'Study' },
  { id: 'search', label: 'Search' },
  { id: 'settings', label: 'Settings' },
];

export function App() {
  const [tab, setTab] = useState<Tab>('study');
  const [quiz, setQuiz] = useState<ListMeta | null>(null);

  useEffect(() => {
    const onPop = () => setQuiz(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const openQuiz = (l: ListMeta) => {
    history.pushState({ quiz: l.id }, '');
    setQuiz(l);
  };

  const exitQuiz = () => {
    if (history.state?.quiz) history.back();
    else setQuiz(null);
  };

  return (
    <>
      <div class="shell" hidden={!!quiz}>
        <main class="shell-main">
          <div hidden={tab !== 'study'}>
            <ListsView active={!quiz && tab === 'study'} onOpen={openQuiz} />
          </div>
          <div hidden={tab !== 'search'}>
            <SearchView />
          </div>
          <div hidden={tab !== 'settings'}>
            <SettingsView active={!quiz && tab === 'settings'} />
          </div>
        </main>
        <nav class="tabbar">
          {TABS.map((t) => (
            <button
              type="button"
              key={t.id}
              class={`tab${tab === t.id ? ' tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <TabIcon tab={t.id} />
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
      {quiz && <QuizView list={quiz} onExit={exitQuiz} />}
    </>
  );
}
