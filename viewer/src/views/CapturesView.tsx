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
import { api } from '@/lib/api';
import { useApi } from '@/lib/useApi';
import { useT } from '@/lib/i18n';
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  OwnershipBadge,
  ShortId,
} from '@/components/StatusBits';

export function CapturesView() {
  const t = useT();
  const { data, loading, error, reload } = useApi(() => api.captures());

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const captures = data?.captures ?? [];
  const malformed = data?.malformed ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('captures.title')}</CardTitle>
        <CardDescription>{t('captures.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        {captures.length === 0 && malformed.length === 0 ? (
          <EmptyBox>{t('captures.empty')}</EmptyBox>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">{t('common.id')}</TableHead>
                <TableHead>{t('captures.proof')}</TableHead>
                <TableHead>{t('captures.category')}</TableHead>
                <TableHead>{t('common.title')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('common.areas')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('common.captured')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {captures.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <ShortId id={c.id} />
                  </TableCell>
                  <TableCell>
                    <OwnershipBadge status={c.status} />
                  </TableCell>
                  <TableCell>
                    {c.record ? (
                      <Badge variant="secondary" className="font-mono">
                        {c.record.category}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {c.record ? (
                      <span className="font-medium">{c.record.title}</span>
                    ) : (
                      <span className="font-mono text-xs text-destructive">
                        {c.error?.code ?? 'unreadable'}
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground md:table-cell">
                    {c.scope ? c.scope.areaIds.length : '—'}
                  </TableCell>
                  <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                    {c.record?.capturedAt.slice(0, 19).replace('T', ' ') ?? '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {malformed.length > 0 ? (
          <p className="mt-4 text-xs text-destructive">
            {malformed.length} {t('common.malformedEntries')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
