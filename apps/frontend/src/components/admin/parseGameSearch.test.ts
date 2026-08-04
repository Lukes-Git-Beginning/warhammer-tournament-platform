import { describe, it, expect } from 'vitest';
import { parseGameSearch } from './AdminAllGamesTab';

describe('parseGameSearch', () => {
  it('treats plain words as player-name search', () => {
    expect(parseGameSearch('RizzOtto Welshlion')).toEqual({ q: 'RizzOtto Welshlion' });
  });

  it('parses operators for each dimension', () => {
    expect(parseGameSearch('winner:RizzOtto')).toEqual({ winner: 'RizzOtto' });
    expect(parseGameSearch('faction:kislev')).toEqual({ faction: 'kislev' });
    expect(parseGameSearch('map:jade')).toEqual({ map: 'jade' });
    expect(parseGameSearch('tournament:saturday')).toEqual({ tournament: 'saturday' });
  });

  it('supports quoted values with spaces', () => {
    expect(parseGameSearch('map:"Jade Tomb"')).toEqual({ map: 'Jade Tomb' });
  });

  it('combines operators and player words (AND)', () => {
    expect(parseGameSearch('winner:RizzOtto map:jade Welshlion')).toEqual({
      winner: 'RizzOtto',
      map: 'jade',
      q: 'Welshlion',
    });
  });

  it('maps a bare "ladder"/"open play" to the tournament shortcut', () => {
    expect(parseGameSearch('ladder')).toEqual({ tournament: 'ladder' });
    expect(parseGameSearch('queue')).toEqual({ tournament: 'ladder' });
  });

  it('treats an unknown operator literally as a name word', () => {
    expect(parseGameSearch('foo:bar')).toEqual({ q: 'foo:bar' });
  });

  it('returns empty for a blank search', () => {
    expect(parseGameSearch('   ')).toEqual({});
  });
});
