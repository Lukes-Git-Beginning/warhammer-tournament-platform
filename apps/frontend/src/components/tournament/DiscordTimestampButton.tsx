import { useState } from 'react';
import { toDiscordTimestamp } from '@/lib/timezone';

interface DiscordTimestampButtonProps {
  isoString: string;
}

export function DiscordTimestampButton({ isoString }: DiscordTimestampButtonProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    void navigator.clipboard.writeText(toDiscordTimestamp(isoString)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title="Copy as Discord timestamp — auto-adjusts to each viewer's timezone"
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[#5865F2] border border-[#5865F2]/40 hover:bg-[#5865F2]/10 transition-colors shrink-0"
    >
      {copied ? '✓ Copied' : '⏱ Discord'}
    </button>
  );
}
