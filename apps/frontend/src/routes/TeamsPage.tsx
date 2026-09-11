import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRequireAuth } from '@/lib/auth';
import { PageShell } from '@/components/layout/PageShell';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
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
  createTeam,
  declineTeam,
  getAllTeams,
  getMyTeams,
  searchTeammates,
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

function TeamCard({ t }: { t: TeamDto }) {
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
      </CardContent>
    </Card>
  );
}

function DirectoryTeamCard({ t }: { t: TeamDirectoryEntry }) {
  return (
    <Card variant="banner">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2">
          <TeamNameLink id={t.id} name={t.name} />
          <span className="text-[10px] font-display uppercase tracking-wide text-rizzotto-stone-500">
            {STATUS_LABEL[t.status] ?? t.status}
          </span>
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
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['teams', 'me'] });

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
  const otherTeams = (allTeamsData?.teams ?? []).filter((t) => !myTeamIds.has(t.id));

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
            {active.length === 0 ? (
              <p className="text-sm text-rizzotto-stone-500">No active teams yet. Create one to compete in 2v2 tournaments.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {active.map((t) => (
                  <TeamCard key={t.id} t={t} />
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
            <h2 className="mb-3 font-display text-lg text-rizzotto-gold-400">All teams</h2>
            {otherTeams.length === 0 ? (
              <p className="text-sm text-rizzotto-stone-500">No other teams yet.</p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {otherTeams.map((t) => (
                  <DirectoryTeamCard key={t.id} t={t} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
