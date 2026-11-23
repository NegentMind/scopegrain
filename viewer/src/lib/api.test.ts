import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('api.request contract', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('parses a successful JSON payload', async () => {
    const payload = { status: 'ok', api: 'scopegrain', schemaVersion: 1 };
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, payload)));
    await expect(api.health()).resolves.toEqual(payload);
    expect(fetch).toHaveBeenCalledWith('/api/health', {
      headers: { Accept: 'application/json' },
    });
  });

  it('maps a structured error body to ApiError with code and status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(404, { error: { code: 'TASK_NOT_FOUND', message: 'nope' } }),
      ),
    );
    const err = await api.task('x').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('TASK_NOT_FOUND');
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe('nope');
  });

  it('survives an error response with a non-JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 502 })),
    );
    const err = await api.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('HTTP_ERROR');
    expect((err as ApiError).status).toBe(502);
  });

  it('encodes path parameters', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, {})));
    await api.task('a/b?c');
    expect(fetch).toHaveBeenCalledWith(
      `/api/tasks/${encodeURIComponent('a/b?c')}`,
      expect.anything(),
    );
  });

  it('catalogDocWrite PUTs the CAS envelope as JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, {
        kind: 'prompt', id: 'p', path: 'prompts/p.md',
        sha256: 'b'.repeat(64), applied: true,
      })),
    );
    await api.catalogDocWrite('prompt', 'p', 'body text', 'a'.repeat(64));
    expect(fetch).toHaveBeenCalledWith('/api/catalog/prompt/p', {
      method: 'PUT',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: 'body text',
        expectedSha256: 'a'.repeat(64),
      }),
    });
  });
});
