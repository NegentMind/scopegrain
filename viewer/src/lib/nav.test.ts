import { describe, expect, it, vi } from 'vitest';
import { consumeTaskRequest, openTask, registerNavigate } from './nav';

describe('cross-view navigation queue', () => {
  it('delivers a pending task id exactly once', () => {
    openTask('task-1');
    expect(consumeTaskRequest()).toBe('task-1');
    expect(consumeTaskRequest()).toBeNull();
  });

  it('routes navigation through the registered handler', () => {
    const nav = vi.fn();
    registerNavigate(nav);
    openTask('task-2');
    expect(nav).toHaveBeenCalledWith('tasks');
    expect(consumeTaskRequest()).toBe('task-2');
  });

  it('keeps the pending id when no handler is registered', () => {
    registerNavigate(null as never);
    // Re-registering restores the handler; without it openTask must not throw.
    expect(() => openTask('task-3')).not.toThrow();
    expect(consumeTaskRequest()).toBe('task-3');
  });
});
