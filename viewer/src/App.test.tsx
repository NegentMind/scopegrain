import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { api, type Health, type WorkspaceSummary } from './lib/api';
import { setLocale } from './lib/i18n';
import App from './App';

let throwInTasks = false;

vi.mock('@/views/WorkspaceView', () => ({
  WorkspaceView: () => <div>workspace-content</div>,
}));
vi.mock('@/views/TasksView', () => ({
  TasksView: () => {
    if (throwInTasks) throw new Error('tasks crash');
    return <div>tasks-content</div>;
  },
}));
vi.mock('@/views/PlansView', () => ({
  PlansView: () => <div>plans-content</div>,
}));
vi.mock('@/views/SystemView', () => ({
  SystemView: () => <div>system-content</div>,
}));

const HEALTH_OK: Health = {
  status: 'ok',
  api: 'scopegrain',
  schemaVersion: 1,
  serverTime: '2026-01-01T00:00:00.000Z',
};

const WORKSPACE_STUB: WorkspaceSummary = {
  project: {
    name: 'scopegrain',
    configPath: '.scopegrain/config.json',
    methodology: 'manual',
    locale: 'en',
    hosts: [],
    paths: {},
  },
  workspace: null,
  counts: {
    tasks: 0,
    tasksByState: {},
    malformedTasks: 0,
    plans: 0,
    artifacts: {},
    captures: 0,
    journalOperations: 0,
  },
};

describe('App shell navigation', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    throwInTasks = false;
    setLocale('en', { persist: false });
    vi.spyOn(api, 'health').mockResolvedValue(HEALTH_OK);
    vi.spyOn(api, 'workspace').mockResolvedValue(WORKSPACE_STUB);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // The hash router adds a sync navigate() + re-render per tab switch;
  // five sequential userEvent clicks land just past the 5 s default.
  it('keeps a single section header when switching sidebar tabs repeatedly', { timeout: 15000 }, async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('api ok');

    const assertSingleHeader = (title: string) => {
      const headings = screen.getAllByRole('heading', { level: 2 });
      expect(headings).toHaveLength(1);
      expect(headings[0]).toHaveTextContent(title);
    };

    assertSingleHeader('Workspace');

    const sequence = ['Work items', 'Plans', 'System', 'Workspace', 'Work items'];
    for (const label of sequence) {
      await user.click(screen.getByRole('tab', { name: label }));
      assertSingleHeader(label);
    }

    const dupKeyErrors = errorSpy.mock.calls.filter((args: unknown[]) =>
      args.some((a: unknown) => typeof a === 'string' && a.includes('same key')),
    );
    expect(dupKeyErrors).toHaveLength(0);
  });

  it('resets ErrorBoundary when switching to another sidebar tab', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('api ok');

    throwInTasks = true;
    await user.click(screen.getByRole('tab', { name: 'Work items' }));
    expect(screen.getByRole('alert')).toHaveTextContent('tasks crash');

    throwInTasks = false;
    await user.click(screen.getByRole('tab', { name: 'Plans' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('plans-content')).toBeInTheDocument();
  });
});
