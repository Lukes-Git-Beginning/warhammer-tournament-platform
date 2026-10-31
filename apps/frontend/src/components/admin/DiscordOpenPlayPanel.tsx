import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getAdminConfig, postDiscordJoinPanel, putAdminConfig } from '@/lib/api.js';
import { Button } from '@/components/ui/button';

const CONFIG_KEY = 'discord_open_play_guilds';

interface OpenPlayGuild {
  guildId: string;
  label?: string;
  tickerChannelId: string;
  pingRoleId?: string | null;
}

const EMPTY: OpenPlayGuild = { guildId: '', label: '', tickerChannelId: '', pingRoleId: '' };
const isSnowflake = (v: string) => /^\d{17,20}$/.test(v.trim());

/**
 * Discord Open Play servers: per server the ticker channel (open queue requests are posted there,
 * only the bot writes) and an optional ping role. "Post join panel" puts the pinned "Find a game"
 * message into the ticker channel. Ids come from Discord with Developer Mode on (right-click → Copy ID).
 */
export function DiscordOpenPlayPanel() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['admin-config', CONFIG_KEY],
    queryFn: () => getAdminConfig(CONFIG_KEY),
    retry: false,
  });

  const [guilds, setGuilds] = useState<OpenPlayGuild[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (Array.isArray(data?.value)) setGuilds(data.value as OpenPlayGuild[]);
  }, [data]);

  const save = useMutation({
    mutationFn: (next: OpenPlayGuild[]) =>
      putAdminConfig(
        CONFIG_KEY,
        next.map((g) => ({
          guildId: g.guildId.trim(),
          label: g.label?.trim() || undefined,
          tickerChannelId: g.tickerChannelId.trim(),
          pingRoleId: g.pingRoleId?.trim() || null,
        })),
      ),
    onSuccess: () => {
      setStatus('Saved.');
      void queryClient.invalidateQueries({ queryKey: ['admin-config', CONFIG_KEY] });
    },
    onError: (err: Error) => setStatus(err.message),
  });

  const panel = useMutation({
    mutationFn: (guildId: string) => postDiscordJoinPanel(guildId),
    onSuccess: () => setStatus('Panel posted. Pin it in the ticker channel.'),
    onError: (err: Error) => setStatus(err.message),
  });

  const setField = (i: number, field: keyof OpenPlayGuild, value: string) =>
    setGuilds((list) => list.map((g, j) => (j === i ? { ...g, [field]: value } : g)));

  const valid = guilds.every((g) => isSnowflake(g.guildId) && isSnowflake(g.tickerChannelId) && (!g.pingRoleId || isSnowflake(g.pingRoleId)));
  const savedIds = new Set(Array.isArray(data?.value) ? (data.value as OpenPlayGuild[]).map((g) => g.guildId) : []);

  const input =
    'w-full rounded border border-rizzotto-iron-700 bg-rizzotto-iron-900 px-2 py-1 text-sm text-rizzotto-stone-200 focus:border-rizzotto-gold-400/70 focus:outline-none';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-display text-base font-semibold text-rizzotto-gold-400">Discord Open Play</h3>
        {status && <span className="text-xs text-stone-400">{status}</span>}
      </div>
      <p className="mb-4 max-w-2xl text-xs text-stone-400">
        Servers where players use <code>/join</code> and see open queue requests. Only RizzBOTto should be able to send messages
        in the ticker channel. Ids: Discord settings → Advanced → Developer Mode, then right-click → Copy ID.
      </p>

      {isLoading ? (
        <div className="py-4 text-sm text-stone-400">Loading…</div>
      ) : (
        <div className="space-y-3">
          {guilds.map((g, i) => (
            <div key={i} className="grid gap-2 rounded border border-rizzotto-iron-700 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
              <label className="text-xs text-stone-500">
                Name
                <input className={input} value={g.label ?? ''} onChange={(e) => setField(i, 'label', e.target.value)} placeholder="RizzOttoverse" />
              </label>
              <label className="text-xs text-stone-500">
                Server id
                <input className={input} value={g.guildId} onChange={(e) => setField(i, 'guildId', e.target.value)} />
              </label>
              <label className="text-xs text-stone-500">
                Ticker channel id
                <input className={input} value={g.tickerChannelId} onChange={(e) => setField(i, 'tickerChannelId', e.target.value)} />
              </label>
              <label className="text-xs text-stone-500">
                Ping role id (optional)
                <input className={input} value={g.pingRoleId ?? ''} onChange={(e) => setField(i, 'pingRoleId', e.target.value)} />
              </label>
              <div className="flex items-end gap-2">
                <Button
                  variant="etched"
                  size="sm"
                  disabled={!savedIds.has(g.guildId) || panel.isPending}
                  title={savedIds.has(g.guildId) ? 'Post the "Find a game" panel in the ticker channel' : 'Save first'}
                  onClick={() => panel.mutate(g.guildId)}
                >
                  Post join panel
                </Button>
                <Button variant="etched" size="sm" onClick={() => setGuilds((list) => list.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <Button variant="etched" size="sm" onClick={() => setGuilds((list) => [...list, { ...EMPTY }])}>
              Add server
            </Button>
            <Button variant="forge" size="sm" disabled={!valid || save.isPending} onClick={() => save.mutate(guilds)}>
              Save
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
