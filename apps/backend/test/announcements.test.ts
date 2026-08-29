import { describe, it, expect } from 'vitest';
import { buildTournamentFacts, type TournamentFactsInput } from '../src/lib/announcements.js';

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
});
