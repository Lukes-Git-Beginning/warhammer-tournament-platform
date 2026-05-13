import { useState, useEffect } from 'react';

interface DraftTimerProps {
  expiresAt: string; // ISO date
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function DraftTimer({ expiresAt }: DraftTimerProps) {
  const [remaining, setRemaining] = useState(() =>
    Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)),
  );

  useEffect(() => {
    const tick = () =>
      setRemaining(Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const isUrgent = remaining < 10;

  return (
    <div
      className={`flex items-center justify-center rounded-md border px-4 py-2 font-mono text-4xl font-bold ${
        isUrgent
          ? 'border-red-800 bg-red-950/40 text-red-400 animate-pulse'
          : 'border-stone-700 bg-stone-900/40 text-white'
      }`}
    >
      {formatTime(remaining)}
    </div>
  );
}
