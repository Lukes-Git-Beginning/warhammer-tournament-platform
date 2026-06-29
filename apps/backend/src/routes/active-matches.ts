import type { FastifyPluginAsync } from 'fastify';
import type { MatchStatus, MatchType } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// N16: GET /api/me/active-matches
// Returns all "active" matches for the logged-in user that still need attention:
//   1. Tournament matches: status PENDING / ONGOING / AWAITING_CONFIRMATION
//      where the user is player1 or player2
//   2. Open-play matches (type OPEN_PLAY): status ONGOING / AWAITING_CONFIRMATION
//      where the user is a participant
//   3. Scheduled matchups (kind 'challenge'): ACCEPTED matchups where the user
//      is the acceptor and no Match has been created yet.
//      NOTE: ScheduledMatchup has no addressee field (it is a public open board).
//      We surface ACCEPTED matchups where accepted_by_id = me as "upcoming
//      challenges the user committed to".
// ---------------------------------------------------------------------------

export interface ActiveMatchItem {
  matchId: string;
  kind: 'tournament' | 'open_play' | 'challenge';
  status: string;
  opponentName: string | null;
  tournamentSlug: string | null;
  label: string;
}

const TOURNAMENT_ACTIVE: MatchStatus[] = ['PENDING', 'ONGOING', 'AWAITING_CONFIRMATION'];
const OPEN_PLAY_ACTIVE: MatchStatus[] = ['ONGOING', 'AWAITING_CONFIRMATION'];

function phaseLabel(phase: string | null, round: number): string {
  if (phase === 'PLAYOFF_FINAL') return 'Grand Final';
  if (phase === 'PLAYOFF_SF') return 'Semifinal';
  if (phase === 'PLAYOFF_QF') return 'Quarterfinal';
  if (phase === 'PLAYOFF_THIRD_PLACE') return '3rd Place';
  if (round > 0) return `Round ${round}`;
  return 'Match';
}

const TOURNAMENT_TYPE: MatchType = 'TOURNAMENT';
const OPEN_PLAY_TYPE: MatchType = 'OPEN_PLAY';

const activeMatchesRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    '/api/me/active-matches',
    { preHandler: fastify.authenticate },
    async (request) => {
      const userId = request.user.sub;

      // Query 1 + 2: tournament + open-play matches in a single DB call.
      const matches = await fastify.prisma.match.findMany({
        where: {
          deleted_at: null,
          OR: [
            {
              type: TOURNAMENT_TYPE,
              status: { in: TOURNAMENT_ACTIVE },
              OR: [{ player1_id: userId }, { player2_id: userId }],
            },
            {
              type: OPEN_PLAY_TYPE,
              status: { in: OPEN_PLAY_ACTIVE },
              OR: [{ player1_id: userId }, { player2_id: userId }],
            },
          ],
        },
        include: {
          player1: { select: { id: true, username: true } },
          player2: { select: { id: true, username: true } },
          tournament: { select: { slug: true, name: true } },
        },
        orderBy: { created_at: 'asc' },
      });

      // Query 3: ACCEPTED scheduled matchups where I'm the acceptor, no Match yet.
      const challenges = await fastify.prisma.scheduledMatchup.findMany({
        where: {
          accepted_by_id: userId,
          status: 'ACCEPTED',
          match_id: null,
        },
        include: {
          proposer: { select: { id: true, username: true } },
        },
        orderBy: { proposed_at: 'asc' },
      });

      const items: ActiveMatchItem[] = [];

      for (const m of matches) {
        const isPlayer1 = m.player1_id === userId;
        const opponentUser = isPlayer1 ? m.player2 : m.player1;
        const opponentName = opponentUser?.username ?? null;
        const kind: 'tournament' | 'open_play' =
          m.type === 'OPEN_PLAY' ? 'open_play' : 'tournament';

        let label: string;
        if (kind === 'open_play') {
          label = opponentName ? `Open Play vs ${opponentName}` : 'Open Play match';
        } else {
          const roundLabel = phaseLabel(m.phase ?? null, m.round);
          label = opponentName ? `${roundLabel} vs ${opponentName}` : roundLabel;
          if (m.tournament?.name) label = `${m.tournament.name} · ${label}`;
        }

        items.push({
          matchId: m.id,
          kind,
          status: m.status,
          opponentName,
          tournamentSlug: m.tournament?.slug ?? null,
          label,
        });
      }

      for (const c of challenges) {
        const proposerName = c.proposer?.username ?? null;
        const scheduledAt = c.proposed_at.toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'UTC',
        });
        items.push({
          matchId: c.id,
          kind: 'challenge',
          status: 'ACCEPTED',
          opponentName: proposerName,
          tournamentSlug: null,
          label: proposerName
            ? `Challenge from ${proposerName} · ${scheduledAt} UTC`
            : `Scheduled matchup · ${scheduledAt} UTC`,
        });
      }

      return { items };
    },
  );
};

export default activeMatchesRoutes;
