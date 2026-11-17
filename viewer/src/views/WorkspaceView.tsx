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
import { PlansCard } from '@/components/PlansCard';
import { EmptyBox, ErrorBox, ListSkeleton, StateBadge } from '@/components/StatusBits';

export function WorkspaceView() {
  const { data, loading, error, reload } = useApi(() => api.workspace());

  if (loading) return <ListSkeleton rows={4} />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <EmptyBox>No workspace data.</EmptyBox>;

  const { project, workspace, counts } = data;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>{project.name}</CardTitle>
          <CardDescription>
            {project.methodology} · {project.locale} · config {project.configPath}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="flex flex-wrap gap-1.5">
            {project.hosts.map((h) => (
              <Badge key={h} variant="secondary">
                {h}
              </Badge>
            ))}
          </div>
          {workspace ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
              <dt className="text-muted-foreground">workspace</dt>
              <dd className="break-all">{workspace.workspaceId}</dd>
              <dt className="text-muted-foreground">revision</dt>
              <dd>{workspace.revision}</dd>
              <dt className="text-muted-foreground">updated</dt>
              <dd>{workspace.updatedAt}</dd>
            </dl>
          ) : (
            <p className="text-muted-foreground">
              Project is not enrolled: no workspace descriptor. Journal and
              capture endpoints report WORKSPACE_NOT_FOUND.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Store counts</CardTitle>
          <CardDescription>Bounded listing of configured paths</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">tasks</dt>
            <dd className="font-mono">{counts.tasks}</dd>
            <dt className="text-muted-foreground">plans</dt>
            <dd className="font-mono">{counts.plans}</dd>
            <dt className="text-muted-foreground">captures</dt>
            <dd className="font-mono">{counts.captures ?? 'n/a'}</dd>
            <dt className="text-muted-foreground">journal ops</dt>
            <dd className="font-mono">{counts.journalOperations ?? 'n/a'}</dd>
            <dt className="text-muted-foreground">malformed tasks</dt>
            <dd className="font-mono">{counts.malformedTasks}</dd>
          </dl>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Tasks by state</CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(counts.tasksByState).length === 0 ? (
            <EmptyBox>No tasks recorded yet.</EmptyBox>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>State</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(counts.tasksByState).map(([state, n]) => (
                  <TableRow key={state}>
                    <TableCell>
                      <StateBadge state={state} />
                    </TableCell>
                    <TableCell className="text-right font-mono">{n}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <PlansCard />

      {workspace ? (
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Enrolled areas</CardTitle>
            <CardDescription>
              Logical scopes; not OS ACLs or a sandbox.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Area id</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {workspace.areas.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-mono">{a.key}</TableCell>
                    <TableCell>{a.name}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {a.id}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
