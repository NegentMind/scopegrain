import type { CatalogEntry } from './api';

// Maps a catalog to a lookup so markdown links inside resource bodies can
// navigate between projected docs. Pure and side-effect free.

export interface DocRef {
  kind: string;
  id: string;
}

const PLURAL: Record<string, string> = {
  commands: 'command', agents: 'agent', skills: 'skill',
  prompts: 'prompt', rules: 'rule', references: 'reference',
  profiles: 'profile', mcps: 'mcp',
};

export function buildDocIndex(
  entries: Record<string, CatalogEntry[]>,
): Map<string, DocRef> {
  const map = new Map<string, DocRef>();
  for (const [kind, list] of Object.entries(entries)) {
    for (const e of list ?? []) {
      if (e.path) map.set(e.path, { kind, id: e.id });
      map.set(`${kind}/${e.id}`, { kind, id: e.id });
      for (const [plural, k] of Object.entries(PLURAL)) {
        if (k === kind) map.set(`${plural}/${e.id}`, { kind, id: e.id });
      }
    }
  }
  return map;
}

function normalizeHref(href: string): string {
  return href
    .split('#')[0].split('?')[0]
    .replace(/\\/g, '/')
    .replace(/^(\.\.\/)+/, '')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/^(resources|\.scopegrain|\.tasksystem)\//, '');
}

// Resolves a body link to a catalog entry: exact projected path first,
// then suffix match (links may be repo-root-relative or deeper).
export function resolveDocRef(
  href: string,
  index: Map<string, DocRef>,
): DocRef | null {
  const norm = normalizeHref(href).replace(/\/$/, '');
  if (norm === '') return null;
  const direct = index.get(norm);
  if (direct) return direct;
  for (const [path, ref] of index) {
    if (path.endsWith(`/${norm}`) || norm.endsWith(`/${path}`)) {
      return ref;
    }
  }
  return null;
}
