import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@/lib/auth';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { SKILL_BAND_META } from '@/components/bracket/skillBandMeta.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  acceptTeam,
  archiveTeam,
  createTeam,
  declineTeam,
  getAllTeams,
  getMyTeams,
  searchTeammates,
  transferCaptain,
  type TeamDirectoryEntry,
  type TeamDto,
  type TeamMemberDto,
  type UserSearchResult,
} from '@/lib/api';

const STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', FORMING: 'Forming', ARCHIVED: 'Archived' };

function initials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

function MiniAvatar({ url, name }: { url: string | null; name: string }) {
  return (
    <Avatar className="h-6 w-6">
      {url ? <AvatarImage src={url} alt={name} /> : <AvatarFallback>{initials(name)}</AvatarFallback>}
    </Avatar>
  );
}

function MemberRow({ m }: { m: TeamMemberDto }) {
  return (
    <div className="flex items-center gap-2">
      <MiniAvatar url={m.avatar_url} name={m.username} />
      <span className="text-sm text-rizzotto-stone-200">{m.username}</span>
      {m.is_captain && (
        <span className="text-[10px] font-display uppercase tracking-wide text-rizzotto-gold-400">Captain</span>
      )}
      {!m.accepted && (
        <span className="text-[10px] font-display uppercase tracking-wide text-rizzotto-stone-500">Pending</span>
      )}
    </div>
  );
}

function TeamNameLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      to="/teams/$id"
      params={{ id }}
      className="font-display text-rizzotto-stone-100 hover:text-rizzotto-gold-400 transition-colors"
    >
      {name}
    </Link>
  );
}

function TeamCard({
  t,
  onTransfer,
  onDissolve,
  busy,
}: {
  t: TeamDto;
  onTransfer: (id: string) => void;
  onDissolve: (id: string) => void;
  busy?: boolean;
}) {
  const [confirm, setConfirm] = useState<null | 'transfer' | 'dissolve'>(null);
  const teammate = t.members.find((m) => !m.is_captain && m.accepted);
  return (
    <Card variant="banner">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <TeamNameLink id={t.id} name={t.name} />
          {t.is_captain && (
            <span className="text-[10px] font-display uppercase tracking-wide text-rizzotto-gold-400">You are captain</span>
          )}
        </div>
        <div className="mt-2 space-y-1">
          {t.members.map((m) => (
            <MemberRow key={m.user_id} m={m} />
          ))}
        </div>

        {t.is_captain && (
          <div className="mt-3 border-t border-rizzotto-iron-700 pt-3">
            {confirm === 'dissolve' ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-rizzotto-stone-400">Dissolve this team?</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="etched" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="forge" disabled={busy} onClick={() => onDissolve(t.id)}>
                    Confirm
                  </Button>
                </div>
              </div>
            ) : confirm === 'transfer' && teammate ? (
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-rizzotto-stone-400">Make {teammate.username} captain?</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="etched" disabled={busy} onClick={() => setConfirm(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" variant="forge" disabled={busy} onClick={() => onTransfer(t.id)}>
                    Confirm
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {teammate && (
                  <Button size="sm" variant="etched" disabled={busy} onClick={() => setConfirm('transfer')}>
                    Make {teammate.username} captain
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  className="text-rizzotto-blood-400 hover:text-rizzotto-blood-300"
                  onClick={() => setConfirm('dissolve')}
                >
                  Dissolve
                </Button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BandChip({ band }: { band: number }) {
  const meta = SKILL_BAND_META[band];
  if (!meta) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${meta.textCls} ${meta.borderCls} ${meta.bgCls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dotCls}`} />
      {meta.name}
    </span>
  );
}

function DirectoryTeamCard({ t, highlight }: { t: TeamDirectoryEntry; highlight?: boolean }) {
  return (
    <Card variant="banner" className={highlight ? 'border-rizzotto-gold-500/50' : undefined}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {t.rank != null && (
              <span className="shrink-0 w-7 text-right font-display text-sm text-rizzotto-stone-500">#{t.rank}</span>
            )}
            <TeamNameLink id={t.id} name={t.name} />
          </div>
          {t.gs ? (
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-display text-sm font-bold text-rizzotto-gold-400">{Math.round(t.gs.winChance * 100)}%</span>
              <BandChip band={t.gs.band} />
              {t.gs.provisional && (
                <span className="rounded border border-rizzotto-iron-600 px-1 py-0.5 text-[9px] font-display uppercase tracking-wide text-rizzotto-stone-500">
                  Prov
                </span>
              )}
            </div>
          ) : (
            <span className="shrink-0 text-[10px] font-display uppercase tracking-wide text-rizzotto-stone-500">
              {STATUS_LABEL[t.status] ?? t.status}
            </span>
          )}
        </div>
        <div className="mt-2 space-y-1">
          {t.members.map((m) => (
            <MemberRow key={m.user_id} m={m} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function CreateTeamDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [q, setQ] = useState('');
  const [partner, setPartner] = useState<UserSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: search } = useQuery({
    queryKey: ['teammate-search', q],
    queryFn: () => searchTeammates(q),
    enabled: q.trim().length >= 2,
  });

  function reset() {
    setName('');
    setQ('');
    setPartner(null);
    setError(null);
  }

  const create = useMutation({
    mutationFn: () => createTeam({ name: name.trim(), partner_user_id: partner!.id }),
    onSuccess: () => {
      setOpen(false);
      reset();
      onCreated();
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Failed to create team'),
  });

  function submit() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Team name must be at least 2 characters');
      return;
    }
    if (!partner) {
      setError('Pick a teammate to invite');
      return;
    }
    create.mutate();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="forge">Create team</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New 2v2 team</DialogTitle>
          <DialogDescription>
            Name your duo and invite a teammate — they confirm via a Discord DM. The roster is permanent.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-display uppercase tracking-wide text-rizzotto-stone-400">
              Team name
            </label>
            <Input value={name} maxLength={40} placeholder="e.g. Doomstack Duo" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-display uppercase tracking-wide text-rizzotto-stone-400">
              Teammate
            </label>
            {partner ? (
              <div className="flex items-center justify-between rounded-md border border-rizzotto-iron-700 p-2">
                <div className="flex items-center gap-2">
                  <MiniAvatar url={partner.avatar_url} name={partner.username} />
                  <span className="text-sm text-rizzotto-stone-200">{partner.username}</span>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setPartner(null)}>
                  Change
                </Button>
              </div>
            ) : (
              <>
                <Input value={q} placeholder="Search by username…" onChange={(e) => setQ(e.target.value)} />
                {(search?.users?.length ?? 0) > 0 && (
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-md border border-rizzotto-iron-700">
                    {search!.users.map((u) => (
                      <button
                        key={u.id}
                        type="button"
                        className="flex w-full items-center gap-2 p-2 text-left hover:bg-rizzotto-iron-800"
                        onClick={() => {
                          setPartner(u);
                          setQ('');
                        }}
                      >
                        <MiniAvatar url={u.avatar_url} name={u.username} />
                        <span className="text-sm text-rizzotto-stone-200">{u.username}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
          {error && <p className="text-sm text-rizzotto-blood-400">{error}</p>}
        </div>
        <DialogFooter showCloseButton>
          <Button variant="forge" disabled={create.isPending} onClick={submit}>
            {create.isPending ? 'Creating…' : 'Create & invite'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamsPage() {
  const { data: user, isLoading } = useRequireAuth();
  const qc = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['teams', 'me'] });
    void qc.invalidateQueries({ queryKey: ['teams', 'all'] });
  };

  const { data, isLoading: teamsLoading } = useQuery({
    queryKey: ['teams', 'me'],
    queryFn: getMyTeams,
    enabled: !!user,
  });
  const { data: allTeamsData } = useQuery({
    queryKey: ['teams', 'all'],
    queryFn: getAllTeams,
    enabled: !!user,
  });

  const accept = useMutation({ mutationFn: (id: string) => acceptTeam(id), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: (id: string) => declineTeam(id), onSuccess: invalidate });
  const onActionError = (e: unknown) => setActionError(e instanceof Error ? e.message : 'Action failed');
  const transfer = useMutation({
    mutationFn: (id: string) => transferCaptain(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: onActionError,
  });
  const dissolve = useMutation({
    mutationFn: (id: string) => archiveTeam(id),
    onSuccess: () => {
      setActionError(null);
      invalidate();
    },
    onError: onActionError,
  });

  if (isLoading) {
    return (
      <PageShell variant="narrow" className="text-rizzotto-stone-400">
        Loading…
      </PageShell>
    );
  }
  if (!user) return null;

  const teams = data?.teams ?? [];
  const myId = user.id;
  const pendingInvites = teams.filter(
    (t) => t.status === 'FORMING' && !t.is_captain && t.members.some((m) => m.user_id === myId && !m.accepted),
  );
  const active = teams.filter((t) => t.status === 'ACTIVE');
  const forming = teams.filter((t) => t.status === 'FORMING' && t.is_captain);
  const myTeamIds = new Set(teams.map((t) => t.id));
  const rankedTeams = allTeamsData?.teams ?? [];

  return (
    <PageShell variant="wide">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-rizzotto-gold-500">Teams</h1>
          <p className="mt-2 text-sm text-rizzotto-stone-400">
            Form a permanent 2v2 duo. As captain you register the team and act on its behalf.
          </p>
        </div>
        <CreateTeamDialog onCreated={invalidate} />
      </header>

      {teamsLoading ? (
        <p className="text-rizzotto-stone-400">Loading teams…</p>
      ) : (
        <div className="space-y-8">
          {pendingInvites.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg text-rizzotto-gold-400">Invitations</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {pendingInvites.map((t) => (
                  <Card key={t.id} variant="banner">
                    <CardContent className="p-4">
                      <div className="font-display text-rizzotto-stone-100">{t.name}</div>
                      <div className="mt-2 space-y-1">
                        {t.members.map((m) => (
                          <MemberRow key={m.user_id} m={m} />
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Button size="sm" variant="forge" disabled={accept.isPending} onClick={() => accept.mutate(t.id)}>
                          Accept
                        </Button>
                        <Button size="sm" variant="etched" disabled={decline.isPending} onClick={() => decline.mutate(t.id)}>
                          Decline
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-3 font-display text-lg text-rizzotto-gold-400">Your teams</h2>
            {actionError && (
              <p className="mb-3 rounded-md border border-rizzotto-blood-500/40 bg-rizzotto-blood-950/30 p-2 text-sm text-rizzotto-blood-300">
                {actionError}
              </p>
            )}
            {active.length === 0 ? (
              <p className="text-sm text-rizzotto-stone-500">No active teams yet. Create one to compete in 2v2 tournaments.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((t) => (
                  <TeamCard
                    key={t.id}
                    t={t}
                    onTransfer={(id) => transfer.mutate(id)}
                    onDissolve={(id) => dissolve.mutate(id)}
                    busy={transfer.isPending || dissolve.isPending}
                  />
                ))}
              </div>
            )}
          </section>

          {forming.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-lg text-rizzotto-gold-400">Awaiting confirmation</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {forming.map((t) => (
                  <Card key={t.id}>
                    <CardContent className="p-4">
                      <TeamNameLink id={t.id} name={t.name} />
                      <p className="mt-1 text-xs text-rizzotto-stone-500">Waiting for your teammate to accept the invite.</p>
                      <div className="mt-2 space-y-1">
                        {t.members.map((m) => (
                          <MemberRow key={m.user_id} m={m} />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-1 font-display text-lg text-rizzotto-gold-400">Team rankings</h2>
            <p className="mb-3 text-xs text-rizzotto-stone-500">
              Active teams ranked by team General Skill (win chance vs an average team).
            </p>
            {rankedTeams.length === 0 ? (
              <p className="text-sm text-rizzotto-stone-500">No teams yet.</p>
            ) : (
              <div className="grid gap-2">
                {rankedTeams.map((t) => (
                  <DirectoryTeamCard key={t.id} t={t} highlight={myTeamIds.has(t.id)} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
