import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  api,
  ApiError,
  type CatalogDocResponse,
  type CatalogResponse,
} from '@/lib/api';
import { setLocale } from '@/lib/i18n';
import { CatalogView } from './CatalogView';

const PIN = 'a'.repeat(64);

const CATALOG: CatalogResponse = {
  catalog: {
    counts: { prompt: 1 },
    entries: {
      prompt: [
        {
          id: 'demo-prompt',
          description: 'Demo prompt',
          path: 'prompts/demo-prompt.md',
        },
      ],
    },
    aliases: [],
  },
};

function doc(overrides: Partial<NonNullable<CatalogDocResponse['doc']>> = {}) {
  return {
    doc: {
      kind: 'prompt',
      id: 'demo-prompt',
      path: 'prompts/demo-prompt.md',
      sha256: PIN,
      writable: true,
      body: 'hello\n',
      bytes: 6,
      updatedAt: '2026-01-01T00:00:00.000Z',
      ...overrides,
    },
  } satisfies CatalogDocResponse;
}

async function openDocPanel(user: ReturnType<typeof userEvent.setup>) {
  // The default kind tab is 'command'; the fixture only has prompt
  // entries, so switch kind first, then expand the row.
  await user.click(await screen.findByRole('radio', { name: /Prompts/ }));
  await user.click(await screen.findByText('demo-prompt'));
}

describe('CatalogView doc editor', () => {
  beforeEach(() => {
    setLocale('en', { persist: false });
    vi.spyOn(api, 'catalog').mockResolvedValue(CATALOG);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hides the edit affordance when the doc is not writable', async () => {
    vi.spyOn(api, 'catalogDoc').mockResolvedValue(doc({ writable: false }));
    render(<CatalogView />);
    await openDocPanel(userEvent.setup());
    // The DocPanel loaded once its sha256 header line renders.
    await screen.findByText(/sha256:aaaa/);
    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
  });

  it('saves via PUT with the sha256 the GET returned (CAS)', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'catalogDoc').mockResolvedValue(doc());
    const write = vi.spyOn(api, 'catalogDocWrite').mockResolvedValue({
      kind: 'prompt',
      id: 'demo-prompt',
      path: 'prompts/demo-prompt.md',
      sha256: 'b'.repeat(64),
      applied: true,
    });
    render(<CatalogView />);
    await openDocPanel(user);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const area = screen.getByLabelText('Catalog document editor');
    await user.clear(area);
    await user.type(area, 'edited body');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(write).toHaveBeenCalledWith(
        'prompt', 'demo-prompt', 'edited body', PIN));
    await screen.findByText('Saved.');
  });

  it('shows a conflict notice with reload on 409', async () => {
    const user = userEvent.setup();
    vi.spyOn(api, 'catalogDoc').mockResolvedValue(doc());
    vi.spyOn(api, 'catalogDocWrite').mockRejectedValue(
      new ApiError(409, 'WRITE_CONFLICT', 'catalog doc changed'));
    render(<CatalogView />);
    await openDocPanel(user);
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const area = screen.getByLabelText('Catalog document editor');
    await user.type(area, 'x');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Edit conflict');
    expect(
      screen.getByRole('button', { name: 'Reload document' }),
    ).toBeInTheDocument();
    // Reload discards the draft and exits edit mode.
    await user.click(screen.getByRole('button', { name: 'Reload document' }));
    await waitFor(() =>
      expect(
        screen.queryByLabelText('Catalog document editor'),
      ).not.toBeInTheDocument());
  });
});
