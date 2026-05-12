import type { MatchupCell, FactionDto } from '@tww3/types';
import { FactionBadge } from './FactionBadge';

interface MatchupHeatmapProps {
  cells: MatchupCell[];
  factions: FactionDto[];
}

function winrateColor(winrate: number, lowConfidence: boolean): string {
  // hsl: 0=red, 60=yellow, 120=green — red means losing, green means winning
  const hue = winrate * 120;
  const opacity = lowConfidence ? 0.3 : 1;
  return `hsla(${hue.toFixed(0)}, 60%, 30%, ${opacity})`;
}

export function MatchupHeatmap({ cells, factions }: MatchupHeatmapProps) {
  // Sort by display_order asc
  const sorted = [...factions].sort((a, b) => a.display_order - b.display_order);

  // Build lookup map: "aId|bId" → cell (stored only one way)
  const cellMap = new Map<string, MatchupCell>();
  for (const cell of cells) {
    cellMap.set(`${cell.faction_a_id}|${cell.faction_b_id}`, cell);
  }

  function getCell(
    rowId: string,
    colId: string,
  ): { winrate: number; total: number; label: string } | null {
    // Try direct
    const direct = cellMap.get(`${rowId}|${colId}`);
    if (direct) {
      const winrate = direct.winrate_a ?? 0;
      const total = direct.total;
      const pct = Math.round(winrate * 100);
      const rowFaction = factions.find((f) => f.id === rowId);
      const colFaction = factions.find((f) => f.id === colId);
      return {
        winrate,
        total,
        label: `${rowFaction?.name ?? rowId} vs ${colFaction?.name ?? colId}: ${direct.faction_a_wins}-${direct.faction_b_wins} (${total} Matches, ${pct}%)`,
      };
    }
    // Try reversed — row is faction_b, col is faction_a → winrate perspective flipped
    const reversed = cellMap.get(`${colId}|${rowId}`);
    if (reversed) {
      const winrateRaw = reversed.winrate_a ?? 0;
      const winrate = 1 - winrateRaw;
      const total = reversed.total;
      const pct = Math.round(winrate * 100);
      const rowFaction = factions.find((f) => f.id === rowId);
      const colFaction = factions.find((f) => f.id === colId);
      return {
        winrate,
        total,
        label: `${rowFaction?.name ?? rowId} vs ${colFaction?.name ?? colId}: ${reversed.faction_b_wins}-${reversed.faction_a_wins} (${total} Matches, ${pct}%)`,
      };
    }
    return null;
  }

  return (
    <div className="overflow-x-auto">
      <table className="border-collapse text-xs">
        <thead>
          <tr>
            {/* Empty top-left corner */}
            <th className="p-1" />
            {sorted.map((col) => (
              <th key={col.id} className="p-1">
                <div className="flex justify-center">
                  <FactionBadge
                    colorHex={col.color_hex}
                    initials={col.initials}
                    name={col.name}
                    size="sm"
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.id}>
              {/* Row label */}
              <td className="p-1">
                <FactionBadge
                  colorHex={row.color_hex}
                  initials={row.initials}
                  name={row.name}
                  size="sm"
                />
              </td>
              {sorted.map((col) => {
                // Diagonal
                if (row.id === col.id) {
                  return (
                    <td
                      key={col.id}
                      className="p-0 text-center"
                      style={{ backgroundColor: '#1c1917', width: 24, height: 24 }}
                    >
                      <span className="text-stone-600">—</span>
                    </td>
                  );
                }

                const data = getCell(row.id, col.id);

                if (!data) {
                  return (
                    <td
                      key={col.id}
                      className="p-0"
                      style={{ backgroundColor: '#292524', width: 24, height: 24 }}
                    />
                  );
                }

                const bg = winrateColor(data.winrate, data.total < 5);

                return (
                  <td
                    key={col.id}
                    title={data.label}
                    className="p-0 cursor-default"
                    style={{ backgroundColor: bg, width: 24, height: 24 }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
