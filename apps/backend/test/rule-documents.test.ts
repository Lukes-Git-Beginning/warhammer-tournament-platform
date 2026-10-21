/**
 * Rules-document permalinks (/rules/<slug> → an external document). The targets are admin-edited
 * through the generic AdminConfig PUT, which does not validate — so the merge on read is the guard.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RULE_DOCUMENTS, mergeRuleDocuments } from '../src/lib/rule-documents.js';

const conquest = (url: string) => ({ slug: 'fruit-rules-conquest', label: 'Fruit Rules (Conquest)', url, battle_types: ['CONQUEST'] });

describe('mergeRuleDocuments', () => {
  it('offers the Conquest and Land Battle permalinks before anything is set', () => {
    expect(mergeRuleDocuments(undefined)).toEqual(DEFAULT_RULE_DOCUMENTS);
    expect(DEFAULT_RULE_DOCUMENTS.map((d) => [d.slug, d.battle_types])).toEqual([
      ['fruit-rules-conquest', ['CONQUEST']],
      ['fruit-rules-land-battle', ['LAND_BATTLE']],
    ]);
  });

  it('a stored entry replaces its default; order stays stable', () => {
    const docs = mergeRuleDocuments([conquest('https://example.com/fruit-conquest.pdf')]);
    expect(docs.map((d) => d.slug)).toEqual(['fruit-rules-conquest', 'fruit-rules-land-battle']);
    expect(docs[0]!.url).toBe('https://example.com/fruit-conquest.pdf');
  });

  it('never lets a non-http(s) target through (the permalink page redirects to it)', () => {
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com/x.pdf', 'not a url']) {
      expect(mergeRuleDocuments([conquest(url)])[0]!.url).toBe(DEFAULT_RULE_DOCUMENTS[0]!.url); // dropped → the default
    }
  });

  it('keeps extra documents after the defaults and drops malformed ones', () => {
    const docs = mergeRuleDocuments([
      { slug: 'tt-map-notes', label: 'TT Map Notes', url: 'https://example.com/notes', battle_types: ['DOMINATION'] },
      { slug: 'Bad Slug!', label: 'x', url: 'https://example.com' },
      'junk',
    ]);
    expect(docs.map((d) => d.slug)).toEqual(['fruit-rules-conquest', 'fruit-rules-land-battle', 'tt-map-notes']);
  });
});
