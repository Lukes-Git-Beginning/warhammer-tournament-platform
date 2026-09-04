import { useState } from 'react';
import { broadcastAdmin, type BroadcastAudience } from '@/lib/api';

type Tier = 'supporter' | 'lord' | 'champion';

const inputClass =
  'w-full rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-200 focus:border-rizzotto-gold-500 focus:outline-none';
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-rizzotto-gold-500/80';
const chip = (active: boolean) =>
  `rounded border px-3 py-1 text-sm transition-colors ${
    active
      ? 'border-rizzotto-gold-500 bg-rizzotto-gold-500/15 text-rizzotto-gold-300'
      : 'border-stone-700 text-stone-400 hover:bg-stone-800'
  }`;

const BANDS = [1, 2, 3, 4, 5];
const TIERS: Tier[] = ['supporter', 'lord', 'champion'];

export function BroadcastDmTab() {
  const [message, setMessage] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const [activeDays, setActiveDays] = useState(30);
  const [bands, setBands] = useState<number[]>([]);
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const audience = (): BroadcastAudience => ({ activeOnly, activeDays, bands, tiers });

  const toggle = <T,>(setter: React.Dispatch<React.SetStateAction<T[]>>, val: T) =>
    setter((prev) => (prev.includes(val) ? prev.filter((x) => x !== val) : [...prev, val]));

  const preview = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await broadcastAdmin(message, audience(), true);
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
    const c = count == null ? 'the selected' : String(count);
    if (!window.confirm(`Send this DM to ${c} recipient(s)? This cannot be undone.`)) return;
    setBusy(true);
    setStatus(null);
    try {
      const r = await broadcastAdmin(message, audience(), false);
      setStatus(`Sending to ${r.count} recipient(s). They will receive it over the next minute or two.`);
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const noFilters = !activeOnly && bands.length === 0 && tiers.length === 0;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section>
        <h3 className="mb-1 font-display text-base font-semibold text-rizzotto-gold-400">Broadcast a DM</h3>
        <p className="mb-4 text-xs text-stone-500">
          Sends a direct message from the bot to everyone matching the filters below. Filters combine (AND); leave
          them all off to reach every registered player. Use sparingly, one send per hour.
        </p>
        <textarea
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Your message. Discord markdown works. Recipients get a short 'from RizzOtto's Arena' header automatically."
          className={`${inputClass} resize-y`}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Activity</label>
          <label className="flex items-center gap-2 text-sm text-stone-300">
            <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
            Only players active in the last
            <input
              type="number"
              min={1}
              max={365}
              value={activeDays}
              onChange={(e) => setActiveDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
              disabled={!activeOnly}
              className="w-16 rounded border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-200 disabled:opacity-40"
            />
            days
          </label>
        </div>
        <div>
          <label className={labelClass}>Supporter tier</label>
          <div className="flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <button key={t} type="button" onClick={() => toggle(setTiers, t)} className={chip(tiers.includes(t))}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Skill band (headline)</label>
          <div className="flex flex-wrap gap-2">
            {BANDS.map((b) => (
              <button key={b} type="button" onClick={() => toggle(setBands, b)} className={chip(bands.includes(b))}>
                Band {b}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 border-t border-stone-800 pt-4">
        <button
          type="button"
          onClick={preview}
          disabled={busy}
          className="rounded border border-stone-700 px-3 py-1.5 text-sm text-stone-300 transition-colors hover:bg-stone-800 disabled:opacity-40"
        >
          {busy ? 'Working…' : 'Preview recipients'}
        </button>
        {count != null && (
          <span className="text-sm text-stone-300">
            <strong className="text-rizzotto-gold-400">{count}</strong> recipient(s)
            {noFilters && ' (everyone)'}
          </span>
        )}
        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="rounded border border-rizzotto-gold-700 bg-rizzotto-gold-500/10 px-4 py-1.5 text-sm text-rizzotto-gold-400 transition-colors hover:bg-rizzotto-gold-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Send broadcast
        </button>
      </section>

      {status && <p className="text-sm text-stone-400">{status}</p>}
    </div>
  );
}
