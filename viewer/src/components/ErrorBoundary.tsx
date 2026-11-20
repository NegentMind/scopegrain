import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { t, type Locale } from '@/lib/i18n';

interface Props {
  children: ReactNode;
  // Display name of the protected region (a nav label), used in the fallback.
  region?: string;
  // Locale is resolved by the owner and passed down so the class boundary
  // stays free of hook subscriptions.
  locale: Locale;
}

interface State {
  error: Error | null;
}

function Fallback({
  error,
  region,
  locale,
  onRetry,
}: {
  error: Error;
  region?: string;
  locale: Locale;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-destructive/40 bg-destructive/5 px-6 py-12 text-center"
    >
      <AlertTriangle className="size-8 text-destructive" aria-hidden />
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t(locale, 'error.title')}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {region
            ? t(locale, 'error.viewDescNamed').replace('{region}', region)
            : t(locale, 'error.viewDesc')}
        </p>
      </div>
      <details className="max-w-xl text-left">
        <summary className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline">
          {t(locale, 'error.details')}
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto rounded-md border bg-muted/50 p-3 text-xs whitespace-pre-wrap break-all">
          {error.message}
        </pre>
      </details>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t(locale, 'common.retry')}
      </Button>
    </div>
  );
}

// Render-crash isolation: a faulting view swaps to an accessible fallback
// instead of unmounting the whole shell. Remounting the boundary (the owner
// keys it by the active view) or pressing Retry clears the error state.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[viewer] render crash', this.props.region ?? '', error, info);
  }

  private retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <Fallback
          error={error}
          region={this.props.region}
          locale={this.props.locale}
          onRetry={this.retry}
        />
      );
    }
    return this.props.children;
  }
}
