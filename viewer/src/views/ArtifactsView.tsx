import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ToggleGroup,
  ToggleGroupItem,
} from '@/components/ui/toggle-group';
import {
  api,
  type ArtifactKind,
  type ArtifactSummary,
} from '@/lib/api';
import { useApi } from '@/lib/useApi';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  ShortId,
} from '@/components/StatusBits';
import { cn } from '@/lib/utils';
import { useT, useTEnum } from '@/lib/i18n';
import { Markdown } from '@/components/Markdown';

const CHAIN_KINDS: ArtifactKind[] = ['spec', 'design', 'report'];
const OTHER_KINDS: ArtifactKind[] = [
  'research',
  'decision',
  'lesson',
  'handoff',
  'review',
];
const ALL_KINDS: ArtifactKind[] = [...CHAIN_KINDS, ...OTHER_KINDS];

type Selection =
  | { type: 'artifact'; id: string }
  | { type: 'doc'; name: string }
  | null;

export function ArtifactsView() {
  const t = useT();
  const te = useTEnum();
  const [kind, setKind] = useState<ArtifactKind>('spec');
  const [sel, setSel] = useState<Selection>(null);
  const list = useApi(() => api.artifacts(kind), [kind]);
  const docs = useApi(() => api.artifactDocs(kind), [kind]);
  const detail = useApi<ArtifactSummary | null>(
    () =>
      sel?.type === 'artifact'
        ? api.artifact(kind, sel.id).then((r) => r.artifact)
        : Promise.resolve(null),
    [kind, sel],
  );

  const artifactCount = list.data?.artifacts.length ?? 0;
  const docCount = docs.data?.docs.length ?? 0;

  return (
    <div className="space-y-4">
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={2}
        value={kind}
        onValueChange={(v) => {
          if (v) {
            setKind(v as ArtifactKind);
            setSel(null);
          }
        }}
        aria-label={t('artifacts.kind')}
        className="flex-wrap justify-start"
      >
        {ALL_KINDS.map((k) => (
          <ToggleGroupItem key={k} value={k} className="font-mono">
            {k}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {list.loading || docs.loading ? (
        <ListSkeleton />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : docs.error ? (
        <ErrorBox error={docs.error} onRetry={docs.reload} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <div className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="font-mono">{kind}</CardTitle>
                <CardDescription>
                  {artifactCount} {t('artifacts.count')}
                  {kind === 'spec' || kind === 'design' || kind === 'report'
                    ? ' · chain: spec → design → report'
                    : ''}
                  {list.data?.truncated ? t('common.truncatedByApi') : ''}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {artifactCount === 0 ? (
                  <EmptyBox>{t('artifacts.empty')}</EmptyBox>
                ) : (
                  <Table role="grid">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">{t('common.id')}</TableHead>
                        <TableHead>{t('common.title')}</TableHead>
                        <TableHead>{t('artifacts.view')}</TableHead>
                        <TableHead className="hidden md:table-cell">{t('artifacts.created')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.data?.artifacts.map((a) => (
                        <TableRow
                          key={a.id}
                          onClick={() => setSel({ type: 'artifact', id: a.id })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault(); // Space must not scroll the page
                              setSel({ type: 'artifact', id: a.id });
                            }
                          }}
                          tabIndex={0}
                          aria-selected={sel?.type === 'artifact' && sel.id === a.id}
                          className={cn(
                            'cursor-pointer focus-visible:outline-ring',
                            sel?.type === 'artifact' && sel.id === a.id && 'bg-accent',
                          )}
                        >
                          <TableCell>
                            <ShortId id={a.id} />
                          </TableCell>
                          <TableCell className="font-medium">{a.title}</TableCell>
                          <TableCell className="font-mono text-xs">
                            v{a.schemaVersion}
                          </TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                            {a.createdAt.slice(0, 19).replace('T', ' ')}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('artifacts.docs')}</CardTitle>
                <CardDescription>
                  {docCount} {t('artifacts.docCount')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {docCount === 0 ? (
                  <EmptyBox>{t('artifacts.docEmpty')}</EmptyBox>
                ) : (
                  <ScrollArea className="max-h-80">
                    <ul className="space-y-1.5">
                      {docs.data?.docs.map((d) => (
                        <li key={`${d.dir}/${d.name}`}>
                          <button
                            type="button"
                            onClick={() => setSel({ type: 'doc', name: d.name })}
                            className={cn(
                              'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-ring',
                              sel?.type === 'doc' && sel.name === d.name && 'bg-accent',
                            )}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium">
                                {d.title}
                              </span>
                              <span className="block truncate font-mono text-[10px] text-muted-foreground">
                                {d.dir}/{d.name}
                              </span>
                            </span>
                            {d.status ? (
                              <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                                {te('astatus', d.status)}
                              </Badge>
                            ) : null}
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {d.date ?? d.updatedAt.slice(0, 10)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          <Card className="min-w-0 self-start">
            <CardHeader>
              <CardTitle>{t('artifacts.detail')}</CardTitle>
              <CardDescription>
                {sel === null
                  ? t('artifacts.selectArtifact')
                  : sel.type === 'artifact'
                    ? <ShortId id={sel.id} />
                    : sel.name}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!sel ? (
                <EmptyBox>{t('artifacts.selectPromptFull')}</EmptyBox>
              ) : sel.type === 'artifact' ? (
                detail.loading ? (
                  <ListSkeleton rows={3} />
                ) : detail.error ? (
                  <ErrorBox error={detail.error} onRetry={detail.reload} />
                ) : detail.data ? (
                  <ArtifactPanel artifact={detail.data} />
                ) : null
              ) : (
                <DocPanel kind={kind} name={sel.name} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function DocPanel({ kind, name }: { kind: ArtifactKind; name: string }) {
  const t = useT();
  const doc = useApi(() => api.artifactDoc(kind, name), [kind, name]);
  if (doc.loading) return <ListSkeleton rows={3} />;
  if (doc.error) return <ErrorBox error={doc.error} onRetry={doc.reload} />;
  if (!doc.data) return null;
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        {doc.data.dir}/{doc.data.name} · {doc.data.bytes} B ·{' '}
        {doc.data.updatedAt.slice(0, 10)}
        {doc.data.docTruncated ? ` ${t('artifacts.bodyTruncated')}` : ''}
      </p>
      <ScrollArea className="max-h-[36rem] rounded-md border bg-muted/40 p-4">
        <Markdown>{doc.data.doc}</Markdown>
      </ScrollArea>
    </div>
  );
}

function ArtifactPanel({ artifact }: { artifact: ArtifactSummary }) {
  const t = useT();
  const te = useTEnum();
  const data = artifact.data as Record<string, unknown> | null;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono">
          {te('akind', artifact.kind)}
        </Badge>
        <Badge variant="secondary" className="font-mono">
          v{artifact.schemaVersion}
        </Badge>
      </div>
      <section aria-label={t('artifacts.body')}>
        <div className="max-h-96 overflow-auto rounded-md border bg-muted/50 p-3">
          <Markdown>{artifact.body}</Markdown>
        </div>
        {artifact.bodyTruncated ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {t('artifacts.bodyTruncated')}
          </p>
        ) : null}
      </section>
      {data && artifact.kind === 'design' ? (
        <section aria-label={t('artifacts.specBinding')} className="text-xs">
          <h4 className="mb-1 font-medium uppercase text-muted-foreground">
            {t('artifacts.specBinding')}
          </h4>
          <p className="break-all font-mono">
            specId {String(data.specId ?? '—')}
          </p>
          <p className="break-all font-mono text-muted-foreground">
            specDigest {String(data.specDigest ?? '—').slice(0, 24)}…
          </p>
        </section>
      ) : null}
      {artifact.references.length > 0 ? (
        <section aria-label={t('artifacts.references')}>
          <h4 className="mb-1 text-xs font-medium uppercase text-muted-foreground">
            {t('artifacts.references')}
          </h4>
          <ul className="list-inside list-disc font-mono text-xs">
            {artifact.references.map((r) => (
              <li key={r} className="break-all">
                {r}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
