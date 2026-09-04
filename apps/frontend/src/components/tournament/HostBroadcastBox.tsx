import { useState } from 'react';
import { broadcastToParticipants } from '@/lib/api';

/** Host/co-host control: DM all of this tournament's participants via the bot. */
export function HostBroadcastBox({ slug }: { slug: string }) {
  const [message, setMessage] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const preview = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await broadcastToParticipants(slug, message, true);
      setCount(r.count);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!message.trim()) {
      setStatus('Write a message first.');
      return;
    }
    const c = count == null ? 'all' : String(count);
    if (!window.confirm(`DM this to ${c} participant(s)? This cannot be undone.`)) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await broadcastToParticipants(slug, message, false);
      setStatus(`Sending to ${r.count} participant(s). They will get it over the next minute or two.`);
      setMessage('');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4">
      <h4 className="mb-1 text-sm font-semibold text-rizzotto-stone-200">Message participants</h4>
      <p className="mb-3 text-xs text-rizzotto-stone-500">
        Sends a DM from the bot to everyone registered or checked in. They get a short header saying it is from the
        host of this tournament. One send per hour.
      </p>
      <textarea
        rows={3}
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="e.g. We start in 15 minutes, please check in."
        className="w-full resize-y rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={preview}
          disabled={busy}
          className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:bg-stone-800 disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Preview count'}
        </button>
        {count != null && (
          <span className="text-sm text-stone-300">
            <strong className="text-rizzotto-gold-400">{count}</strong> participant(s)
          </span>
        )}
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send DM
        </button>
      </div>
      {status && <p className="mt-2 text-sm text-stone-400">{status}</p>}
    </div>
  );
}
