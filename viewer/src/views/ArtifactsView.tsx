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
import {
  SelectableRow,
  useRovingTabindex,
} from '@/components/SelectableRow';
import { DocListItem } from '@/components/DocListItem';
import { DocPanel } from '@/components/DocPanel';
import { fmtDateTime, fmtRel, shortHash } from '@/lib/format';
import { useLocale, useT, useTEnum } from '@/lib/i18n';
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
  const locale = useLocale();
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
  const roving = useRovingTabindex<HTMLTableSectionElement>();

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
            {te('akind', k)}
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
                  {/* TODO(i18n): 'chain: spec → design → report' needs a
                      catalog key (W3). */}
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
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-20">{t('common.id')}</TableHead>
                        <TableHead>{t('common.title')}</TableHead>
                        <TableHead>{t('artifacts.view')}</TableHead>
                        <TableHead className="hidden md:table-cell">{t('artifacts.created')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody {...roving}>
                      {list.data?.artifacts.map((a, i) => (
                        <SelectableRow
                          key={a.id}
                          selected={sel?.type === 'artifact' && sel.id === a.id}
                          onSelect={() => setSel({ type: 'artifact', id: a.id })}
                          tabIndex={sel?.type !== 'artifact' && i === 0 ? 0 : undefined}
                          className="animate-in fade-in-50 duration-200"
                        >
                          <TableCell className="whitespace-nowrap">
                            <ShortId id={a.id} />
                          </TableCell>
                          <TableCell className="font-medium">{a.title}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono tabular-nums text-xs">
                            v{a.schemaVersion}
                          </TableCell>
                          <TableCell className="hidden whitespace-nowrap tabular-nums text-xs text-muted-foreground md:table-cell">
                            <span title={fmtDateTime(a.createdAt, locale)}>
                              {fmtRel(a.createdAt, locale)}
                            </span>
                          </TableCell>
                        </SelectableRow>
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
                          <DocListItem
                            selected={sel?.type === 'doc' && sel.name === d.name}
                            onSelect={() => setSel({ type: 'doc', name: d.name })}
                            title={d.title}
                            subtitle={`${d.dir}/${d.name}`}
                            badge={
                              d.status ? (
                                <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
                                  {te('astatus', d.status)}
                                </Badge>
                              ) : null
                            }
                            meta={d.date ?? fmtDateTime(d.updatedAt, locale)}
                          />
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </CardContent>
            </Card>
          </div>

          {sel?.type === 'doc' ? (
            <ArtifactDocPanel key={sel.name} kind={kind} name={sel.name} />
          ) : (
            <Card className="min-w-0 self-start">
              <CardHeader>
                <CardTitle>{t('artifacts.detail')}</CardTitle>
                <CardDescription>
                  {sel === null
                    ? t('artifacts.selectArtifact')
                    : <ShortId id={sel.id} />}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {!sel ? (
                  <EmptyBox title={t('artifacts.selectArtifact')}>
                    {t('artifacts.selectPromptFull')}
                  </EmptyBox>
                ) : detail.loading ? (
                  <ListSkeleton rows={3} />
                ) : detail.error ? (
                  <ErrorBox error={detail.error} onRetry={detail.reload} />
                ) : detail.data ? (
                  <div
                    key={sel.id}
                    className="animate-in fade-in-50 slide-in-from-right-1 duration-200"
                  >
                    <ArtifactPanel artifact={detail.data} />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ArtifactDocPanel({ kind, name }: { kind: ArtifactKind; name: string }) {
  const t = useT();
  const locale = useLocale();
  const doc = useApi(() => api.artifactDoc(kind, name), [kind, name]);
  return (
    <DocPanel
      title={name}
      description={
        doc.data
          ? `${doc.data.dir}/${doc.data.name} · ${doc.data.bytes} B · ${fmtDateTime(doc.data.updatedAt, locale)}${doc.data.docTruncated ? ` ${t('artifacts.bodyTruncated')}` : ''}`
          : undefined
      }
      className="min-w-0 animate-in fade-in-50 slide-in-from-right-1 self-start duration-200 max-h-[36rem]"
    >
      {doc.loading ? (
        <ListSkeleton rows={3} />
      ) : doc.error ? (
        <ErrorBox error={doc.error} onRetry={doc.reload} />
      ) : doc.data ? (
        <Markdown>{doc.data.doc}</Markdown>
      ) : null}
    </DocPanel>
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
        <Badge variant="secondary" className="font-mono tabular-nums">
          v{artifact.schemaVersion}
        </Badge>
      </div>
      <section aria-label={t('artifacts.body')}>
        <div className="max-h-[36rem] overflow-auto rounded-md border bg-muted/50 p-3">
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
          {/* TODO(i18n): 'specId'/'specDigest' field labels need catalog
              keys (W3). */}
          <p className="break-all font-mono">
            specId {String(data.specId ?? '—')}
          </p>
          <p className="break-all font-mono text-muted-foreground">
            specDigest {shortHash(String(data.specDigest ?? '—'), 24)}…
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
