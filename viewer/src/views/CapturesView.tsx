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
import {
  EmptyBox,
  ErrorBox,
  ListSkeleton,
  OwnershipBadge,
  ShortId,
} from '@/components/StatusBits';

export function CapturesView() {
  const { data, loading, error, reload } = useApi(() => api.captures());

  if (loading) return <ListSkeleton />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const captures = data?.captures ?? [];
  const malformed = data?.malformed ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Captures &amp; ownership</CardTitle>
        <CardDescription>
          Typed notes with journal-proved ownership. proved = sidecar +
          committed two-event operation + current bytes match snapshot;
          drifted = current source differs from its snapshot.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {captures.length === 0 && malformed.length === 0 ? (
          <EmptyBox>No captures recorded.</EmptyBox>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-20">Id</TableHead>
                <TableHead>Proof</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Title</TableHead>
                <TableHead className="hidden md:table-cell">Areas</TableHead>
                <TableHead className="hidden md:table-cell">Captured</TableHead>
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
            {malformed.length} malformed capture file
            {malformed.length === 1 ? '' : 's'} surfaced.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
