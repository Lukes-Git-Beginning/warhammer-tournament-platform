import { describe, it, expect } from 'vitest';
import {
  buildTournamentFacts,
  buildAnnouncementPrompt,
  generatePushToken,
  hashPushToken,
  pushTokenMatches,
  parseAnnouncementDrafts,
  type TournamentFactsInput,
  type AnnouncementDestination,
} from '../src/lib/announcements.js';

const BASE: TournamentFactsInput = {
  name: 'DLC Launch Prize Fight',
  slug: 'dlc-launch-prize-fight',
  format: 'BALANCED_LIECHTENSTEIN',
  mode: 'BPT',
  startDate: new Date('2026-09-01T18:00:00.000Z'),
  registrationDeadline: new Date('2026-08-31T18:00:00.000Z'),
  maxParticipants: 32,
  participantCount: 12,
  entryFee: '5 EUR',
  rules: 'Best of three in the final.',
  standardRulesEnabled: true,
  restrictions: 'No Masque of Slaanesh.',
  factionNames: ['High Elves', 'Skaven'],
  mapNames: ['Blasted Rock', 'The Fangs'],
  discordLink: 'https://discord.gg/example',
  streamUrl: 'https://twitch.tv/example',
  isMajor: true,
  frontendUrl: 'https://rizzotto.gg',
};

describe('buildTournamentFacts', () => {
  it('builds the sign-up URL and a full fact block', () => {
    const facts = buildTournamentFacts(BASE);
    expect(facts.signupUrl).toBe('https://rizzotto.gg/tournaments/dlc-launch-prize-fight');
    expect(facts.name).toBe('DLC Launch Prize Fight');

    const b = facts.block;
    expect(b).toContain('Tournament name: DLC Launch Prize Fight');
    expect(b).toContain('MAJOR tournament');
    expect(b).toContain('Format: Balanced Liechtenstein');
    expect(b).toContain('Mode: Blind Pick Tournament');
    expect(b).toContain('Sign-up link: https://rizzotto.gg/tournaments/dlc-launch-prize-fight');
    expect(b).toContain('Players registered so far: 12 (cap 32)');
    expect(b).toContain('Entry fee: 5 EUR');
    expect(b).toContain('Faction pool (only these are allowed): High Elves, Skaven');
    expect(b).toContain('Map pool: Blasted Rock, The Fangs');
    expect(b).toContain('community Standard Ruleset applies');
    expect(b).toContain('Custom restrictions: No Masque of Slaanesh.');
  });

  it('emits Discord timestamp tokens for start and deadline (not literal dates)', () => {
    const facts = buildTournamentFacts(BASE);
    const startUnix = Math.floor(BASE.startDate!.getTime() / 1000);
    const deadlineUnix = Math.floor(BASE.registrationDeadline!.getTime() / 1000);
    expect(facts.block).toContain(`Starts: <t:${startUnix}:F>`);
    expect(facts.block).toContain(`Registration deadline: <t:${deadlineUnix}:F>`);
  });

  it('omits unset optional fields and reports an open faction pool', () => {
    const facts = buildTournamentFacts({
      ...BASE,
      isMajor: false,
      entryFee: null,
      maxParticipants: null,
      registrationDeadline: null,
      standardRulesEnabled: false,
      restrictions: '',
      rules: null,
      factionNames: [],
      mapNames: [],
      discordLink: null,
      streamUrl: null,
    });
    const b = facts.block;
    expect(b).not.toContain('MAJOR tournament');
    expect(b).not.toContain('Entry fee');
    expect(b).not.toContain('Registration deadline');
    expect(b).not.toContain('Map pool');
    expect(b).not.toContain('Standard Ruleset');
    expect(b).not.toContain('Custom restrictions');
    expect(b).not.toContain('(cap');
    expect(b).toContain('Faction pool: all factions allowed.');
    expect(b).toContain('Players registered so far: 12');
  });

  it('strips a trailing slash from the frontend URL', () => {
    const facts = buildTournamentFacts({ ...BASE, frontendUrl: 'https://rizzotto.gg/' });
    expect(facts.signupUrl).toBe('https://rizzotto.gg/tournaments/dlc-launch-prize-fight');
  });

  it("includes the host's description and leans-on hint", () => {
    const facts = buildTournamentFacts({ ...BASE, description: 'Monthly ranked showdown, bring your best.' });
    expect(facts.block).toContain("Host's description");
    expect(facts.block).toContain('Monthly ranked showdown, bring your best.');
  });

  it('states the BaLi round plan (4 rounds, 3 under 8) when no round count is set', () => {
    const facts = buildTournamentFacts({ ...BASE, format: 'BALANCED_LIECHTENSTEIN', playoffFormat: 'TOP8' });
    expect(facts.block).toContain('Planned structure: 4 rounds (drops to 3 if fewer than 8 players sign up), then TOP 8 playoffs.');
  });

  it('states an explicit round count and playoff when set', () => {
    const facts = buildTournamentFacts({ ...BASE, format: 'SWISS', roundsCount: 5, playoffFormat: 'TOP4' });
    expect(facts.block).toContain('Planned structure: 5 rounds, then TOP 4 playoffs.');
  });

  it('surfaces a third-place match only when it exists, never its absence', () => {
    const withThird = buildTournamentFacts({ ...BASE, hasThirdPlaceMatch: true });
    expect(withThird.block).toContain('third-place match');
    const withoutThird = buildTournamentFacts({ ...BASE, hasThirdPlaceMatch: false });
    expect(withoutThird.block).not.toContain('third-place match');
  });
});

const DEST: AnnouncementDestination = {
  id: 'dest-1',
  name: 'Official TW Discord',
  ref: 'tw-main',
  brief: 'Official Total War Discord — a Domination tournament, warm and welcoming to newcomers.',
  explain_level: 'FULL',
  length: 'MEDIUM',
  role_mention: '@everyone',
  intro: 'Hey all!',
  outro: 'See you on the field.',
};

describe('buildAnnouncementPrompt', () => {
  it('embeds facts, poster, slug, the push instruction and each destination brief', () => {
    const facts = buildTournamentFacts(BASE);
    const prompt = buildAnnouncementPrompt(
      facts,
      'https://rizzotto.gg/uploads/posters/x/y.jpg',
      BASE.slug,
      [DEST],
    );
    expect(prompt).toContain("Alex's own plain, direct voice");
    expect(prompt).toContain('POST https://rizzotto.gg/api/announcements/push');
    expect(prompt).toContain(`"slug": "${BASE.slug}"`);
    expect(prompt).toContain('Tournament name: DLC Launch Prize Fight');
    expect(prompt).toContain('Poster link: https://rizzotto.gg/uploads/posters/x/y.jpg');
    expect(prompt).toContain('destinationId=dest-1');
    expect(prompt).toContain('Official TW Discord');
    expect(prompt).toContain('Domination tournament');
    expect(prompt).toContain('explanation level: FULL');
    expect(prompt).toContain('sign-up ref (append ?ref=<this> to the sign-up link): tw-main');
    // No em dash and no rigid "VERBATIM" instruction in the new prompt.
    expect(prompt).not.toContain('VERBATIM');
  });

  it('derives the sign-up ref from the destination name when none is given', () => {
    const facts = buildTournamentFacts(BASE);
    const prompt = buildAnnouncementPrompt(facts, null, BASE.slug, [{ ...DEST, ref: '' }]);
    expect(prompt).toContain('sign-up ref (append ?ref=<this> to the sign-up link): official-tw-discord');
  });

  it('includes host notes as a dedicated section when provided', () => {
    const facts = buildTournamentFacts(BASE);
    const prompt = buildAnnouncementPrompt(facts, null, BASE.slug, [DEST], '50 EUR prize pool, top 4 get DLC keys.');
    expect(prompt).toContain('SPECIFIC TO THIS ANNOUNCEMENT');
    expect(prompt).toContain('50 EUR prize pool, top 4 get DLC keys.');
  });

  it('notes when there are no destinations and no poster', () => {
    const facts = buildTournamentFacts(BASE);
    const prompt = buildAnnouncementPrompt(facts, null, BASE.slug, []);
    expect(prompt).toContain('Poster link: none');
    expect(prompt).toContain('(none configured');
  });
});

describe('push token', () => {
  it('generates a 64-char hex token and hashes deterministically', () => {
    const token = generatePushToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPushToken(token)).toBe(hashPushToken(token));
    expect(hashPushToken(token)).not.toBe(token);
  });

  it('matches only the correct token (constant-time), rejects wrong/empty', () => {
    const token = generatePushToken();
    const hash = hashPushToken(token);
    expect(pushTokenMatches(token, hash)).toBe(true);
    expect(pushTokenMatches('wrong', hash)).toBe(false);
    expect(pushTokenMatches('', hash)).toBe(false);
    expect(pushTokenMatches(token, null)).toBe(false);
  });
});

describe('parseAnnouncementDrafts', () => {
  it('parses a valid drafts map and rejects junk', () => {
    const valid = {
      'some-slug': {
        generatedAt: '2026-08-29T00:00:00.000Z',
        results: [{ destinationId: 'd1', name: 'Server', text: 'Post body' }],
      },
    };
    expect(parseAnnouncementDrafts(valid)).toEqual(valid);
    expect(parseAnnouncementDrafts(null)).toEqual({});
    expect(parseAnnouncementDrafts({ x: { bad: true } })).toEqual({});
  });
});
