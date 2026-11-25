import { Fragment, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Pencil, RefreshCw, Save, X } from 'lucide-react';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import {
  Card, CardContent,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  api,
  ApiError,
  type CatalogDepKey,
  type CatalogEntry,
  type RuleIndexItem,
} from '@/lib/api';
import { navigate } from '@/lib/hashRoute';
import { toneClasses, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';
import { buildDocIndex, resolveDocRef } from '@/lib/docIndex';
import { Markdown } from '@/components/Markdown';
import { useApi } from '@/lib/useApi';
import { useT, useLocale } from '@/lib/i18n';
import { CATALOG_DESC_ES } from '@/lib/catalogEs';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';

const KIND_ORDER = [
  'command', 'agent', 'skill', 'prompt', 'rule', 'reference', 'profile', 'mcp',
];

const DEP_KEYS: CatalogDepKey[] = [
  'agents', 'skills', 'rules', 'references', 'prompts', 'mcps',
];

function Bindings({
  entry,
  onNavigate,
}: {
  entry: CatalogEntry;
  onNavigate?: (kind: string, id: string) => void;
}) {
  const t = useT();
  const groups = DEP_KEYS.filter(
    (dk) => Array.isArray(entry[dk]) && entry[dk]!.length > 0,
  );
  if (groups.length === 0) {
    return <span className="text-muted-foreground">{t('common.none')}</span>;
  }
  // Cap visible chips per dep group (audit P2-09): the full binding list
  // was a wall of badges; the overflow collapses into a `+n` chip whose
  // tooltip lists the remaining ids.
  const CHIP_CAP = 3;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {groups.map((dk) => {
        const ids = entry[dk]!;
        const rest = ids.slice(CHIP_CAP);
        return (
          <span key={dk} className="inline-flex flex-wrap items-center gap-1">
            <span className="text-xs text-muted-foreground">
              {t(`catalog.dep.${dk}`)}:
            </span>
            {ids.slice(0, CHIP_CAP).map((id) => (
              <button
                key={id}
                type="button"
                title={t('catalog.viewDoc')}
                onClick={() => onNavigate?.(dk.slice(0, -1), id)}
              >
                <Badge
                  variant="secondary"
                  className="font-mono text-xs hover:bg-accent"
                >
                  {id}
                </Badge>
              </button>
            ))}
            {rest.length > 0 ? (
              <Badge
                variant="outline"
                className="font-mono text-xs"
                title={rest.join(', ')}
              >
                +{rest.length}
              </Badge>
            ) : null}
          </span>
        );
      })}
    </div>
  );
}

function DocPanel({
  kind,
  id,
  onInternalLink,
}: {
  kind: string;
  id: string;
  onInternalLink?: (href: string) => boolean;
}) {
  const t = useT();
  const locale = useLocale();
  const { data, loading, error, reload } = useApi(
    () => api.catalogDoc(kind, id, locale),
    [kind, id, locale],
  );
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<
    { code?: string; message: string } | null
  >(null);
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);

  // A different doc drops all local edit state — a draft belongs to the
  // specific kind/id payload it was started from.
  useEffect(() => {
    setEditing(false);
    setDraft('');
    setSaving(false);
    setSaveError(null);
    setConflict(false);
    setSaved(false);
  }, [kind, id]);

  // The save confirmation is a transient status, not a persistent
  // banner: auto-dismiss after ~3 s (audit H9).
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), 3000);
    return () => clearTimeout(timer);
  }, [saved]);

  if (loading) return <ListSkeleton label={t('common.loading')} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.doc) {
    return <EmptyBox>{t('catalog.docMissing')}</EmptyBox>;
  }
  const d = data.doc;
  // Edit requires: write-enabled API (writable) + a pinned sha256 to CAS
  // on + the full body — a truncated render must never round-trip back
  // to disk.
  const canEdit = d.writable === true && d.sha256 !== null && !d.truncated;

  const startEdit = () => {
    setDraft(d.body);
    setEditing(true);
    setSaveError(null);
    setConflict(false);
    setSaved(false);
  };
  const cancelEdit = () => {
    setEditing(false);
    setDraft('');
    setSaveError(null);
    setConflict(false);
  };
  const saveEdit = async () => {
    if (d.sha256 === null) return;
    setSaving(true);
    setSaveError(null);
    setConflict(false);
    try {
      await api.catalogDocWrite(kind, id, draft, d.sha256);
      setEditing(false);
      setDraft('');
      setSaved(true);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
      } else {
        setSaveError({
          code: e instanceof ApiError ? e.code : undefined,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    } finally {
      setSaving(false);
    }
  };
  const reloadDoc = () => {
    // The on-disk version wins a CAS conflict: reload discards the draft.
    setEditing(false);
    setDraft('');
    setSaveError(null);
    setConflict(false);
    reload();
  };

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs text-muted-foreground">
          {d.path} · {d.bytes} B
          {d.sha256 ? ` · sha256:${d.sha256.slice(0, 12)}…` : ''}
          {d.truncated ? ` · ${t('catalog.docTruncated')}` : ''}
        </div>
        {locale === 'es' && d.locale === 'en' ? (
          <div role="status" className="text-xs text-warn">
            {t('catalog.docCanonical')}
          </div>
        ) : null}
        {canEdit && !editing ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={startEdit}
          >
            <Pencil />
            {t('catalog.edit')}
          </Button>
        ) : null}
      </div>
      {saved && !editing ? (
        <div role="status" className="text-xs text-ok">
          {t('catalog.saved')}
        </div>
      ) : null}
      {editing ? (
        <div className="space-y-2">
          {conflict ? (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>{t('catalog.conflictTitle')}</AlertTitle>
              <AlertDescription>
                {t('catalog.conflictDesc')}
              </AlertDescription>
              <AlertAction>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reloadDoc}
                >
                  <RefreshCw />
                  {t('catalog.reloadDoc')}
                </Button>
              </AlertAction>
            </Alert>
          ) : null}
          {saveError ? <ErrorBox error={saveError} /> : null}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('catalog.editArea')}
            spellCheck={false}
            className="h-[28rem] w-full rounded-md border bg-muted/30 p-4 font-mono text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void saveEdit()}
              disabled={saving}
            >
              <Save />
              {saving ? t('catalog.saving') : t('catalog.save')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={cancelEdit}
              disabled={saving}
            >
              <X />
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="max-h-[32rem] overflow-auto rounded-md border bg-muted/30 p-4">
          <Markdown onInternalLink={onInternalLink}>{d.body}</Markdown>
        </div>
      )}
    </div>
  );
}

const RULE_STATUS_TONE: Record<string, Tone> = {
  active: 'ok',
  proposed: 'info',
  archived: 'neutral',
};

// Rules index panel (read-only): the lifecycle surface the workspace
// catalog + local overlay expose — hydrated meta, never the rule body
// (that stays behind the catalog doc panel). A rule whose bytes drifted
// or whose frontmatter failed closed lands in `malformed` with its
// code; the index never fabricates a status for it.
function RulesPanel({ onOpenDoc }: { onOpenDoc: (id: string) => void }) {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.rulesIndex());
  if (loading) return <ListSkeleton label={t('common.loading')} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const items = data?.rules?.items ?? [];
  const malformed = data?.rules?.malformed ?? [];
  return (
    <Card>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{t('catalog.rules.title')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('catalog.rules.desc')}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate('captures')}
            title={t('catalog.rules.capturesHint')}
          >
            {t('catalog.rules.openCaptures')}
          </Button>
        </div>
        {malformed.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>{t('catalog.rules.malformedTitle')}</AlertTitle>
            <AlertDescription className="font-mono text-xs">
              {malformed.map((m) => `${m.id} (${m.code})`).join(' · ')}
            </AlertDescription>
          </Alert>
        ) : null}
        {items.length === 0 ? (
          <EmptyBox>{t('catalog.rules.empty')}</EmptyBox>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-56">{t('common.id')}</TableHead>
                <TableHead>{t('catalog.rules.status')}</TableHead>
                <TableHead>{t('catalog.rules.origin')}</TableHead>
                <TableHead>{t('catalog.rules.activation')}</TableHead>
                <TableHead>{t('catalog.rules.enforcement')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((r: RuleIndexItem) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => onOpenDoc(r.id)}
                        title={t('catalog.viewDoc')}
                      >
                        <Badge variant="outline" className="font-mono">
                          {r.id}
                        </Badge>
                      </button>
                      {r.overlay === 'local' ? (
                        <Badge
                          variant="secondary"
                          className="font-mono text-xs"
                        >
                          {t('catalog.rules.local')}
                        </Badge>
                      ) : null}
                      {r.category ? (
                        <Badge variant="secondary" className="text-xs">
                          {r.category}
                        </Badge>
                      ) : null}
                    </div>
                    {r.path ? (
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {r.path}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span
                      className={cn(
                        'inline-flex rounded-md border px-1.5 py-0.5 text-xs font-medium',
                        toneClasses(RULE_STATUS_TONE[r.status ?? ''] ?? 'warn').badge,
                      )}
                    >
                      {r.status ?? t('common.none')}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {r.origin ?? t('common.none')}
                  </TableCell>
                  <TableCell>
                    {r.activation?.globs?.length ? (
                      <div className="flex max-w-xs flex-wrap gap-1">
                        {r.activation.globs.slice(0, 3).map((g) => (
                          <Badge
                            key={g}
                            variant="secondary"
                            className="font-mono text-xs"
                          >
                            {g}
                          </Badge>
                        ))}
                        {r.activation.globs.length > 3 ? (
                          <span className="text-xs text-muted-foreground">
                            +{r.activation.globs.length - 3}
                          </span>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('catalog.rules.transversal')}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">
                    <span
                      className={cn(
                        toneClasses(r.enforcement?.level === 'strict' ? 'warn' : 'neutral').text,
                      )}
                    >
                      {r.enforcement?.level ?? t('common.none')}
                    </span>
                    {r.enforcement?.verificationRef ? (
                      <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                        {r.enforcement.verificationRef}
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {data?.rules?.truncated ? (
          <p className="text-xs text-muted-foreground">
            {t('catalog.docTruncated')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function CatalogView() {
  const t = useT();
  const locale = useLocale();
  const { data, loading, error, reload } = useApi(() => api.catalog());
  const [kind, setKind] = useState<string>('command');
  const desc = useMemo(() => {
    if (locale !== 'es') return (e: CatalogEntry) => e.description;
    return (e: CatalogEntry) =>
      CATALOG_DESC_ES[`${kind}:${e.id}`] ?? e.description;
  }, [locale, kind]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const docIndex = useMemo(
    () => buildDocIndex(data?.catalog?.entries ?? {}),
    [data],
  );

  const navigateDoc = (targetKind: string, id: string) => {
    setKind(targetKind);
    setQ('');
    setOpen(id);
    requestAnimationFrame(() => {
      const reduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      document
        .getElementById(`catalog-row-${id}`)
        ?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    });
  };

  const handleInternalLink = (href: string): boolean => {
    const ref = resolveDocRef(href, docIndex);
    if (!ref) return false;
    navigateDoc(ref.kind, ref.id);
    return true;
  };

  const entries = useMemo(() => {
    const list = data?.catalog?.entries?.[kind] ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) =>
      e.id.toLowerCase().includes(needle)
      || desc(e).toLowerCase().includes(needle)
      || (e.path ?? '').toLowerCase().includes(needle));
  }, [data, kind, q, desc]);

  if (loading) return <ListSkeleton label={t('common.loading')} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const counts = data?.catalog?.counts ?? {};

  return (
    <div className="space-y-4">
    <Card>
      {/* No duplicated CardHeader (audit P2-07): the view header above
          already shows title + description. */}
      <CardContent className="space-y-4">
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={2}
          size="sm"
          value={kind}
          onValueChange={(v) => v && setKind(v)}
          aria-label={t('catalog.kindLabel')}
          className="flex-wrap justify-start"
        >
          {KIND_ORDER.filter((k) => counts[k] !== undefined).map((k) => (
            <ToggleGroupItem key={k} value={k}>
              {t(`catalog.kind.${k}`)}
              <Badge variant="secondary" className="ml-1.5 font-mono">
                {counts[k]}
              </Badge>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t('catalog.filter')}
          className="w-full max-w-sm"
          aria-label={t('catalog.filter')}
        />
        {entries.length === 0 ? (
          <EmptyBox>{t('catalog.empty')}</EmptyBox>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-64">{t('common.id')}</TableHead>
                <TableHead>{t('common.description')}</TableHead>
                <TableHead className="w-[38%]">{t('catalog.bindings')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <Fragment key={e.id}>
                  <TableRow id={`catalog-row-${e.id}`}>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setOpen(open === e.id ? null : e.id)}
                          aria-expanded={open === e.id}
                          aria-controls={
                            open === e.id ? `catalog-doc-${e.id}` : undefined
                          }
                          title={t('catalog.viewDoc')}
                        >
                          <Badge variant="outline" className="font-mono">
                            {e.id}
                          </Badge>
                        </button>
                        {(e.modes ?? []).map((m) => (
                          <Badge
                            key={m}
                            variant="secondary"
                            className="font-mono text-xs"
                          >
                            {m}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      <div>{desc(e)}</div>
                      {e.path ? (
                        <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                          {e.path}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Bindings entry={e} onNavigate={navigateDoc} />
                    </TableCell>
                  </TableRow>
                  {open === e.id ? (
                    <TableRow>
                      <TableCell colSpan={3} id={`catalog-doc-${e.id}`}>
                        <DocPanel
                          kind={kind}
                          id={e.id}
                          onInternalLink={handleInternalLink}
                        />
                      </TableCell>
                    </TableRow>
                  ) : null}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
    <RulesPanel onOpenDoc={(id) => navigateDoc('rule', id)} />
    </div>
  );
}
