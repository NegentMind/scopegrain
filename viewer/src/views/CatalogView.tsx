import { useMemo, useState } from 'react';
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
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import { EmptyBox, ErrorBox, ListSkeleton } from '@/components/StatusBits';

const KIND_ORDER = [
  'command', 'agent', 'skill', 'prompt', 'rule', 'reference', 'profile', 'mcp',
];

export function CatalogView() {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.catalog());
  const [kind, setKind] = useState<string>('command');
  const [q, setQ] = useState('');

  const entries = useMemo(() => {
    const list = data?.catalog?.entries?.[kind] ?? [];
    const needle = q.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((e) =>
      e.id.toLowerCase().includes(needle)
      || e.description.toLowerCase().includes(needle));
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Badge variant="outline" className="font-mono">{e.id}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
