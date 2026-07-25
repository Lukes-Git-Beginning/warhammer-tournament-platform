import { describe, it, expect } from 'vitest';
import { parseChangelog, selectSectionsToPost } from '../src/lib/changelog-publish.js';

const SAMPLE = `# Changelog

Intro prose that must be ignored.

## [Unreleased]
Planned things — must never be posted.

## [1.2.0] — 2026-07-25 — Third
### Added
- c

## [1.1.0] — 2026-07-10 — Second
### Fixed
- b

## [1.0.0] — 2026-06-27 — Launch
Launch note. a
`;

describe('parseChangelog', () => {
  it('parses released sections newest-first and skips [Unreleased]', () => {
    const secs = parseChangelog(SAMPLE);
    expect(secs.map((s) => s.version)).toEqual(['1.2.0', '1.1.0', '1.0.0']);
    // Each section carries its heading + body, and stops before the next heading.
    expect(secs[0]!.body.startsWith('## [1.2.0]')).toBe(true);
    expect(secs[0]!.body).toContain('- c');
    expect(secs[0]!.body).not.toContain('[1.1.0]');
    // The [Unreleased] planning blurb is never captured.
    expect(secs.some((s) => /unreleased/i.test(s.body))).toBe(false);
  });
});

describe('selectSectionsToPost', () => {
  const secs = parseChangelog(SAMPLE); // [1.2.0, 1.1.0, 1.0.0]

  it('first run (no cursor) backfills everything, oldest-first', () => {
    expect(selectSectionsToPost(secs, null).map((s) => s.version)).toEqual(['1.0.0', '1.1.0', '1.2.0']);
  });

  it('up-to-date cursor posts nothing', () => {
    expect(selectSectionsToPost(secs, '1.2.0')).toEqual([]);
  });

  it('posts only versions newer than the cursor, oldest-first', () => {
    expect(selectSectionsToPost(secs, '1.0.0').map((s) => s.version)).toEqual(['1.1.0', '1.2.0']);
    expect(selectSectionsToPost(secs, '1.1.0').map((s) => s.version)).toEqual(['1.2.0']);
  });

  it('an unknown cursor is treated as first-run (posts all) — never silently skips', () => {
    expect(selectSectionsToPost(secs, '9.9.9').map((s) => s.version)).toEqual(['1.0.0', '1.1.0', '1.2.0']);
  });
});
