import { useEffect, useMemo, useState } from 'react';

const tagStyles = {
  urgent: 'bg-red-500/20 text-red-300',
  action: 'bg-amber-500/20 text-amber-300',
  info: 'bg-blue-500/20 text-blue-300',
  fyi: 'bg-zinc-500/20 text-zinc-300'
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function formatDate() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date());
}

function Skeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-16 rounded-xl bg-zinc-800/80" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-10 rounded-full bg-zinc-800/80" />
        <div className="h-10 rounded-full bg-zinc-800/80" />
        <div className="h-10 rounded-full bg-zinc-800/80" />
      </div>
      <div className="space-y-2">
        <div className="h-20 rounded-xl bg-zinc-800/80" />
        <div className="h-20 rounded-xl bg-zinc-800/80" />
        <div className="h-20 rounded-xl bg-zinc-800/80" />
      </div>
    </div>
  );
}

export default function App() {
  const [digestPayload, setDigestPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState('');
  const [unauthenticated, setUnauthenticated] = useState(false);

  const digest = digestPayload?.digest;

  useEffect(() => {
    let unsubscribe;
    let hasTerminalResponse = false;
    let fallbackTimeout;

    const applyStatus = (rawPayload = {}) => {
      const status = rawPayload.status || rawPayload.state;
      console.log('[EmailDigest] Received digest update:', rawPayload, 'resolved status:', status);

      if (status === 'loading') {
        console.log('[EmailDigest] Transition -> loading');
        setSpinning(true);
        setLoading(true);
        setError('');
        setUnauthenticated(false);
        return;
      }

      if (status === 'success' || status === 'ready') {
        hasTerminalResponse = true;
        if (fallbackTimeout) {
          clearTimeout(fallbackTimeout);
        }
        console.log('[EmailDigest] Transition -> success');
        setDigestPayload(rawPayload);
        setLoading(false);
        setSpinning(false);
        setError('');
        setUnauthenticated(false);
        return;
      }

      if (status === 'unauthenticated') {
        hasTerminalResponse = true;
        if (fallbackTimeout) {
          clearTimeout(fallbackTimeout);
        }
        console.log('[EmailDigest] Transition -> unauthenticated');
        setLoading(false);
        setSpinning(false);
        setUnauthenticated(true);
        setError(rawPayload.error || 'Connect Gmail to see your digest.');
        return;
      }

      if (status === 'error') {
        hasTerminalResponse = true;
        if (fallbackTimeout) {
          clearTimeout(fallbackTimeout);
        }
        console.log('[EmailDigest] Transition -> error');
        setLoading(false);
        setSpinning(false);
        setUnauthenticated(false);
        setError(rawPayload.error || 'Something went wrong while fetching your digest.');
      }
    };

    const boot = async () => {
      console.log('[EmailDigest] Booting renderer, waiting for digest update');
      console.log('[Renderer] electronAPI available:', Boolean(window.electronAPI));
      console.log('[Renderer] connectGmail available:', Boolean(window.electronAPI?.connectGmail));
      setLoading(true);
      setSpinning(true);

      fallbackTimeout = setTimeout(() => {
        if (!hasTerminalResponse) {
          console.log('[EmailDigest] Transition -> unauthenticated (8s timeout fallback)');
          setLoading(false);
          setSpinning(false);
          setUnauthenticated(true);
          setError('No response from background process. Connect Gmail to continue.');
        }
      }, 8000);

      unsubscribe = window.electronAPI.onDigestUpdate((payload) => applyStatus(payload));
      console.log('[EmailDigest] Calling fetchDigest on mount');
      await window.electronAPI.fetchDigest();
    };

    boot();

    return () => {
      if (fallbackTimeout) {
        clearTimeout(fallbackTimeout);
      }
      if (unsubscribe) {
        unsubscribe();
      }
    };
  }, []);

  const stats = useMemo(() => {
    if (!digest) {
      return { total: 0, need_action: 0, fyi: 0 };
    }
    return digest.stats || { total: digest.emails?.length || 0, need_action: 0, fyi: 0 };
  }, [digest]);

  const emails = digest?.emails || [];

  const handleRefresh = async () => {
    console.log('[EmailDigest] Manual refresh requested');
    setSpinning(true);
    setLoading(true);
    setUnauthenticated(false);
    setError('');
    await window.electronAPI.fetchDigest();
  };

  const handleConnect = async () => {
    console.log('[Renderer] Connect Gmail clicked');
    setSpinning(true);
    setLoading(true);
    setUnauthenticated(false);
    setError('');
    try {
      if (!window.electronAPI?.connectGmail) {
        throw new Error('window.electronAPI.connectGmail is not available.');
      }
      await window.electronAPI.connectGmail();
    } catch (err) {
      console.error('[Renderer] connectGmail invoke failed:', err);
      setLoading(false);
      setSpinning(false);
      setUnauthenticated(true);
      setError('Failed to start Gmail OAuth. Please try again.');
    }
  };

  return (
    <main className="h-full w-full bg-[#0f0f0f]/95 text-zinc-100 p-4">
      <div className="h-full rounded-2xl border border-zinc-800 bg-[#121212]/90 p-4 shadow-2xl flex flex-col gap-4">
        <header className="flex items-start justify-between">
          <div>
          <p className="text-sm text-zinc-300">{getGreeting()}{process.env.USER_NAME ? `, ${process.env.USER_NAME}` : ''}</p>
            <p className="text-xs text-zinc-500">{formatDate()}</p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            className="h-8 w-8 rounded-full border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 transition"
            aria-label="Refresh digest"
          >
            <span className={`block text-sm ${spinning ? 'animate-spin' : ''}`}>↻</span>
          </button>
        </header>

        {loading ? (
          <Skeleton />
        ) : unauthenticated ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-zinc-300">Connect Gmail to generate your daily digest.</p>
            <button
              type="button"
              onMouseDown={handleConnect}
              className="rounded-full bg-white px-4 py-2 text-xs font-medium text-zinc-900 hover:bg-zinc-200"
            >
              Connect Gmail
            </button>
            {error ? <p className="text-xs text-zinc-500">{error}</p> : null}
          </div>
        ) : error && !digest ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={handleRefresh}
              className="rounded-full bg-zinc-200 px-4 py-2 text-xs font-medium text-zinc-900 hover:bg-white"
            >
              Retry
            </button>
          </div>
        ) : (
          <>
            <section className="rounded-xl bg-zinc-800/70 p-3">
              <p className="text-xs text-zinc-400">✨ Highlight</p>
              <p className="mt-1 text-sm text-white">{digest?.highlight || 'No highlight available yet.'}</p>
            </section>

            <section className="grid grid-cols-3 gap-2 text-xs">
              <div className="rounded-full bg-zinc-800/80 px-3 py-2 text-center text-zinc-300">Total: {stats.total}</div>
              <div className="rounded-full bg-zinc-800/80 px-3 py-2 text-center text-zinc-300">Need action: {stats.need_action}</div>
              <div className="rounded-full bg-zinc-800/80 px-3 py-2 text-center text-zinc-300">FYI: {stats.fyi}</div>
            </section>

            <section className="min-h-0 flex-1 overflow-y-auto pr-1 space-y-2">
              {emails.length === 0 ? (
                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-400">
                  Inbox is clear. Enjoy your day.
                </div>
              ) : (
                emails.map((email, index) => (
                  <article key={`${email.subject}-${index}`} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-zinc-100">{email.from}</p>
                        <p className="truncate text-xs text-zinc-400">{email.subject}</p>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] uppercase ${tagStyles[email.tag?.toLowerCase()] || tagStyles.fyi}`}
                      >
                        {email.tag || 'fyi'}
                      </span>
                    </div>
                    <p className="mt-2 max-h-10 overflow-hidden text-xs text-zinc-300">{email.summary}</p>
                  </article>
                ))
              )}
            </section>

            {error ? <p className="text-xs text-red-300">{error}</p> : null}
          </>
        )}
      </div>
    </main>
  );
}
