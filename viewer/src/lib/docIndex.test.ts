import { describe, expect, it } from 'vitest';
import { buildDocIndex, resolveDocRef } from './docIndex';
import type { CatalogEntry } from './api';

const ENTRIES: Record<string, CatalogEntry[]> = {
  command: [
    { id: 'plan-work', kind: 'command', description: 'd',
      path: 'commands/plan-work.md' } as CatalogEntry,
  ],
  skill: [
    { id: 'clarify-intent', kind: 'skill', description: 'd',
      path: 'skills/clarify-intent/SKILL.md' } as CatalogEntry,
  ],
  prompt: [
    { id: 'task-brief', kind: 'prompt', description: 'd',
      path: 'prompts/task-brief.md' } as CatalogEntry,
  ],
};

describe('docIndex', () => {
  const index = buildDocIndex(ENTRIES);

  it('resolves exact projected paths', () => {
    expect(resolveDocRef('commands/plan-work.md', index))
      .toEqual({ kind: 'command', id: 'plan-work' });
  });

  it('strips resources/ and dot-dir prefixes', () => {
    expect(resolveDocRef('resources/skills/clarify-intent/SKILL.md', index))
      .toEqual({ kind: 'skill', id: 'clarify-intent' });
    expect(resolveDocRef('.scopegrain/prompts/task-brief.md', index))
      .toEqual({ kind: 'prompt', id: 'task-brief' });
  });

  it('resolves kind/id and plural/id shorthand', () => {
    expect(resolveDocRef('skill/clarify-intent', index))
      .toEqual({ kind: 'skill', id: 'clarify-intent' });
    expect(resolveDocRef('prompts/task-brief', index))
      .toEqual({ kind: 'prompt', id: 'task-brief' });
  });

  it('resolves suffix matches and ignores anchors/query', () => {
    expect(resolveDocRef('docs/../commands/plan-work.md#section', index))
      .toEqual({ kind: 'command', id: 'plan-work' });
    expect(resolveDocRef('task-brief.md?x=1', index))
      .toEqual({ kind: 'prompt', id: 'task-brief' });
  });

  it('returns null for non-resource hrefs', () => {
    expect(resolveDocRef('https://example.com/x', index)).toBeNull();
    expect(resolveDocRef('', index)).toBeNull();
    expect(resolveDocRef('#anchor', index)).toBeNull();
    expect(resolveDocRef('random/file.txt', index)).toBeNull();
  });
});
