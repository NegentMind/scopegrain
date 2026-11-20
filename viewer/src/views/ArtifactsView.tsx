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
import { useT } from '@/lib/i18n';

const CHAIN_KINDS: ArtifactKind[] = ['spec', 'design', 'report'];
const OTHER_KINDS: ArtifactKind[] = [
  'research',
  'decision',
  'lesson',
  'handoff',
  'review',
];
const ALL_KINDS: ArtifactKind[] = [...CHAIN_KINDS, ...OTHER_KINDS];

export function ArtifactsView() {
  const t = useT();
  const [kind, setKind] = useState<ArtifactKind>('spec');
  const [selected, setSelected] = useState<string | null>(null);
  const list = useApi(() => api.artifacts(kind), [kind]);
  const detail = useApi<ArtifactSummary | null>(
    () =>
      selected
        ? api.artifact(kind, selected).then((r) => r.artifact)
        : Promise.resolve(null),
    [kind, selected],
  );

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
            setSelected(null);
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

      {list.loading ? (
        <ListSkeleton />
      ) : list.error ? (
        <ErrorBox error={list.error} onRetry={list.reload} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="font-mono">{kind}</CardTitle>
              <CardDescription>
                {(list.data?.artifacts.length ?? 0)} {t('artifacts.count')}
                {kind === 'spec' || kind === 'design' || kind === 'report'
                  ? ' · chain: spec → design → report'
                  : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {(list.data?.artifacts.length ?? 0) === 0 ? (
                <EmptyBox>{t('artifacts.empty')}</EmptyBox>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Id</TableHead>
                      <TableHead>{t('common.title')}</TableHead>
                      <TableHead>{t('artifacts.view')}</TableHead>
                      <TableHead className="hidden md:table-cell">{t('artifacts.created')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.data?.artifacts.map((a) => (
                      <TableRow
                        key={a.id}
                        onClick={() => setSelected(a.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            setSelected(a.id);
                          }
                        }}
                        tabIndex={0}
                        aria-selected={selected === a.id}
                        className={cn(
                          'cursor-pointer focus-visible:outline-ring',
                          selected === a.id && 'bg-accent',
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

          <Card className="min-w-0 self-start">
            <CardHeader>
              <CardTitle>{t('artifacts.detail')}</CardTitle>
              <CardDescription>
                {selected ? <ShortId id={selected} /> : t('artifacts.selectArtifact')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!selected ? (
                <EmptyBox>{t('artifacts.selectPromptFull')}</EmptyBox>
              ) : detail.loading ? (
                <ListSkeleton rows={3} />
              ) : detail.error ? (
                <ErrorBox error={detail.error} onRetry={detail.reload} />
              ) : detail.data ? (
                <ArtifactPanel artifact={detail.data} />
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ArtifactPanel({ artifact }: { artifact: ArtifactSummary }) {
  const t = useT();
  const data = artifact.data as Record<string, unknown> | null;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="font-mono">
          {artifact.kind}
        </Badge>
        <Badge variant="secondary" className="font-mono">
          v{artifact.schemaVersion}
        </Badge>
      </div>
      <section aria-label={t('artifacts.body')}>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs">
          {artifact.body}
        </pre>
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
