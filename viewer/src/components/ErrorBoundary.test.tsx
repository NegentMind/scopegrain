import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from './ErrorBoundary';

let shouldThrow = false;
function Fragile() {
  if (shouldThrow) throw new Error('boom in view');
  return <p>healthy content</p>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = false;
    // React logs the caught error; keep test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary locale="en">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByText('healthy content')).toBeInTheDocument();
  });

  it('swaps to an accessible fallback when a child throws', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary locale="en" region="Tasks">
        <Fragile />
      </ErrorBoundary>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong');
    expect(alert).toHaveTextContent('“Tasks” view failed to render');
    expect(alert).toHaveTextContent('boom in view');
    expect(screen.queryByText('healthy content')).not.toBeInTheDocument();
  });

  it('recovers on Retry once the fault is gone', async () => {
    shouldThrow = true;
    render(
      <ErrorBoundary locale="en">
        <Fragile />
      </ErrorBoundary>,
    );
    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText('healthy content')).toBeInTheDocument();
  });

  it('renders the fallback in Spanish', () => {
    shouldThrow = true;
    render(
      <ErrorBoundary locale="es">
        <Fragile />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Algo salió mal');
  });
});
