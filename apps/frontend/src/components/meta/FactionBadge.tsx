interface FactionBadgeProps {
  colorHex: string;
  initials: string;
  name: string;
  size?: 'sm' | 'md' | 'lg';
  iconUrl?: string | null;
}

const SIZE_MAP = {
  sm: { px: 24, textClass: 'text-xs' },
  md: { px: 32, textClass: 'text-sm' },
  lg: { px: 48, textClass: 'text-base' },
} as const;

export function FactionBadge({ colorHex, initials, name, size = 'md', iconUrl }: FactionBadgeProps) {
  const { px, textClass } = SIZE_MAP[size];

  if (iconUrl) {
    return (
      <span
        title={name}
        className="inline-flex items-center justify-center rounded-sm overflow-hidden select-none shrink-0"
        style={{
          width: px,
          height: px,
          minWidth: px,
          backgroundColor: '#837a6f',
        }}
      >
        <img
          src={iconUrl}
          alt=""
          width={px}
          height={px}
          loading="lazy"
          decoding="async"
          className="w-full h-full object-contain"
        />
      </span>
    );
  }

  return (
    <span
      title={name}
      className={`inline-flex items-center justify-center rounded-full font-bold text-white select-none shrink-0 ${textClass}`}
      style={{
        backgroundColor: colorHex,
        width: px,
        height: px,
        minWidth: px,
      }}
    >
      {initials}
    </span>
  );
}
