import type { AvailabilityContext, AvailabilitySlot } from '../../lib/api';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

interface WeekAvailabilityGridProps {
  slots: AvailabilitySlot[];
  context: AvailabilityContext;
  onChange: (slots: AvailabilitySlot[]) => void;
  disabled?: boolean;
}

export function WeekAvailabilityGrid({ slots, context, onChange, disabled }: WeekAvailabilityGridProps) {
  const slotSet = new Set(
    slots.filter((s) => s.context === context).map((s) => `${s.day_of_week}:${s.hour_utc}`),
  );

  function toggle(day: number, hour: number) {
    if (disabled) return;
    const key = `${day}:${hour}`;
    const otherContext = slots.filter((s) => s.context !== context);
    const thisContext = slots.filter((s) => s.context === context);

    let updated: AvailabilitySlot[];
    if (slotSet.has(key)) {
      updated = [...otherContext, ...thisContext.filter((s) => !(s.day_of_week === day && s.hour_utc === hour))];
    } else {
      updated = [...otherContext, ...thisContext, { day_of_week: day, hour_utc: hour, context }];
    }
    onChange(updated);
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid" style={{ gridTemplateColumns: `40px repeat(7, 1fr)`, minWidth: 360 }}>
        {/* Header */}
        <div className="h-7" />
        {DAYS.map((d) => (
          <div key={d} className="h-7 flex items-center justify-center text-xs text-stone-400 font-medium">
            {d}
          </div>
        ))}
        {/* Hour rows */}
        {HOURS.map((hour) => (
          <>
            <div key={`h${hour}`} className="h-6 flex items-center justify-end pr-2 text-xs text-stone-500">
              {String(hour).padStart(2, '0')}
            </div>
            {Array.from({ length: 7 }, (_, day) => {
              const active = slotSet.has(`${day}:${hour}`);
              return (
                <button
                  key={`${day}-${hour}`}
                  type="button"
                  onClick={() => toggle(day, hour)}
                  disabled={disabled}
                  className={[
                    'h-6 border border-stone-800 transition-colors',
                    active
                      ? 'bg-amber-500/70 hover:bg-amber-400/70'
                      : 'bg-stone-900 hover:bg-stone-700',
                    disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
                  ].join(' ')}
                />
              );
            })}
          </>
        ))}
      </div>
      <p className="mt-2 text-xs text-stone-500">Hours in UTC. Click to toggle availability.</p>
    </div>
  );
}
