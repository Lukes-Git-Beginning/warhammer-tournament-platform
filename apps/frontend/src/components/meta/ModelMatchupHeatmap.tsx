import type { FactionMatchupMatrixEntryDto, FactionDto } from '@rizzotto/types';
import { FactionBadge } from './FactionBadge.js';
import { winrateColor } from './MatchupHeatmap.js';

interface ModelMatchupHeatmapProps {
  entries: FactionMatchupMatrixEntryDto[];
  factions: FactionDto[];
}

export function ModelMatchupHeatmap({ entries, factions }: ModelMatchupHeatmapProps) {
  const sorted = [...factions].sort((a, b) => a.name.localeCompare(b.name));

  // Build lookup map: "factionA|factionB" → entry (stored directionally)
  const entryMap = new Map<string, FactionMatchupMatrixEntryDto>();
  for (const entry of entries) {
    entryMap.set(`${entry.factionA}|${entry.factionB}`, entry);
  }

  function getCell(
    rowId: string,
    colId: string,
  ): { winChance: number; matchupEffect: number; sampleSize: number; lowSampleWarning: boolean; label: string } | null {
    // Try direct (row = factionA perspective)
    const direct = entryMap.get(`${rowId}|${colId}`);
    if (direct) {
      const rowFaction = factions.find((f) => f.id === rowId);
      const colFaction = factions.find((f) => f.id === colId);
      const pct = (direct.neutralEqualProficiencyWinChance * 100).toFixed(1);
      return {
        winChance: direct.neutralEqualProficiencyWinChance,
        matchupEffect: direct.matchupEffect,
        sampleSize: direct.sampleSize,
        lowSampleWarning: direct.lowSampleWarning,
        label: `${rowFaction?.name ?? rowId} vs ${colFaction?.name ?? colId}: ${pct}% win chance (matchup effect ${direct.matchupEffect > 0 ? '+' : ''}${direct.matchupEffect.toFixed(3)}, n=${direct.sampleSize})${direct.lowSampleWarning ? ' ⚠ low sample' : ''}`,
      };
    }
    // Try reversed — row is factionB, col is factionA → flip win chance
    const reversed = entryMap.get(`${colId}|${rowId}`);
    if (reversed) {
      const winChance = 1 - reversed.neutralEqualProficiencyWinChance;
      const matchupEffect = -reversed.matchupEffect;
      const rowFaction = factions.find((f) => f.id === rowId);
      const colFaction = factions.find((f) => f.id === colId);
      const pct = (winChance * 100).toFixed(1);
      return {
        winChance,
        matchupEffect,
        sampleSize: reversed.sampleSize,
        lowSampleWarning: reversed.lowSampleWarning,
        label: `${rowFaction?.name ?? rowId} vs ${colFaction?.name ?? colId}: ${pct}% win chance (matchup effect ${matchupEffect > 0 ? '+' : ''}${matchupEffect.toFixed(3)}, n=${reversed.sampleSize})${reversed.lowSampleWarning ? ' ⚠ low sample' : ''}`,
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
                    iconUrl={col.icon_url}
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
                  iconUrl={row.icon_url}
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

                const bg = winrateColor(data.winChance, data.lowSampleWarning);

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
