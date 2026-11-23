import { Fragment, useMemo, useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  api,
  type CatalogDepKey,
  type CatalogEntry,
} from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';

const KIND_ORDER = [
  'command', 'agent', 'skill', 'prompt', 'rule', 'reference', 'profile', 'mcp',
];

const DEP_KEYS: CatalogDepKey[] = [
  'agents', 'skills', 'rules', 'references', 'prompts', 'mcps',
];

function Bindings({ entry }: { entry: CatalogEntry }) {
  const t = useT();
  const groups = DEP_KEYS.filter(
    (dk) => Array.isArray(entry[dk]) && entry[dk]!.length > 0,
  );
  if (groups.length === 0) {
    return <span className="text-muted-foreground">{t('common.none')}</span>;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {groups.map((dk) => (
        <span key={dk} className="inline-flex flex-wrap items-center gap-1">
          <span className="text-xs text-muted-foreground">
            {t(`catalog.dep.${dk}`)}:
          </span>
          {entry[dk]!.map((id) => (
            <Badge key={id} variant="secondary" className="font-mono text-xs">
              {id}
            </Badge>
          ))}
        </span>
      ))}
    </div>
  );
}

function DocPanel({ kind, id }: { kind: string; id: string }) {
  const t = useT();
  const { data, loading, error, reload } = useApi(
    () => api.catalogDoc(kind, id),
    [kind, id],
  );
  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data?.doc) {
    return <EmptyBox>{t('catalog.docMissing')}</EmptyBox>;
  }
  const d = data.doc;
  return (
    <div className="space-y-1.5">
      <div className="font-mono text-xs text-muted-foreground">
        {d.path} · {d.bytes} B
        {d.sha256 ? ` · sha256:${d.sha256.slice(0, 12)}…` : ''}
        {d.truncated ? ` · ${t('catalog.docTruncated')}` : ''}
      </div>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
        {d.body}
      </pre>
    </div>
  );
}

export function CatalogView() {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.catalog());
  const [kind, setKind] = useState<string>('command');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const entries = useMemo(() => {
    const list = data?.catalog?.entries?.[kind] ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) =>
      e.id.toLowerCase().includes(needle)
      || e.description.toLowerCase().includes(needle)
      || (e.path ?? '').toLowerCase().includes(needle));
  }, [data, kind, q]);

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const counts = data?.catalog?.counts ?? {};

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('catalog.title')}</CardTitle>
        <CardDescription>{t('catalog.desc')}</CardDescription>
      </CardHeader>
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
                  <TableRow>
                    <TableCell>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setOpen(open === e.id ? null : e.id)}
                          aria-expanded={open === e.id}
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
                      <div>{e.description}</div>
                      {e.path ? (
                        <div className="mt-0.5 font-mono text-xs opacity-70">
                          {e.path}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Bindings entry={e} />
                    </TableCell>
                  </TableRow>
                  {open === e.id ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <DocPanel kind={kind} id={e.id} />
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
  );
}
