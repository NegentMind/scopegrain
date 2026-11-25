import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// Read-only markdown rendering with theme-consistent element overrides.
// react-markdown emits React elements (no dangerouslySetInnerHTML) and
// ignores raw HTML in the source, so untrusted doc content stays inert.
//
// Heading levels are remapped +2 (# -> h3 … ####+ -> h6) so rendered docs
// nest under the app's h1/h2 outline instead of injecting extra h1s.

// Fallback policy when the consumer supplies no onInternalLink: in-doc
// anchors scroll, repo-relative links are parked in a `#doc-<rel>` hash
// instead of opening a dead external tab, and real external URLs keep the
// target=_blank behavior.
function defaultInternalLink(href: string): boolean {
  if (href.startsWith('#')) {
    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document
      .getElementById(decodeURIComponent(href.slice(1)))
      ?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
    return true;
  }
  // Schemes (https:, mailto:, …) and protocol-relative URLs stay external.
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('//')) return false;
  const rel = href
    .split('#')[0]
    .split('?')[0]
    .replace(/\\/g, '/')
    .replace(/^(\.\.\/)+/, '')
    .replace(/^\.\//, '');
  window.location.hash = `doc-${rel}`;
  return true;
}

export function Markdown({
  children,
  onInternalLink,
}: {
  children: string;
  // Return `false` to let the browser follow the link (e.g. unresolvable
  // refs); `true` or void means "handled, don't navigate".
  onInternalLink?: (href: string) => boolean | void;
}) {
  return (
    <div className="text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h3 className="mb-3 mt-5 border-b pb-1.5 text-xl font-semibold first:mt-0">
              {children}
            </h3>
          ),
          h2: ({ children }) => (
            <h4 className="mb-2 mt-5 border-b pb-1 text-lg font-semibold first:mt-0">
              {children}
            </h4>
          ),
          h3: ({ children }) => (
            <h5 className="mb-2 mt-4 text-base font-semibold">{children}</h5>
          ),
          h4: ({ children }) => (
            <h6 className="mb-1.5 mt-3 text-sm font-semibold">{children}</h6>
          ),
          h5: ({ children }) => (
            <h6 className="mb-1.5 mt-3 text-xs font-semibold">{children}</h6>
          ),
          h6: ({ children }) => (
            <h6 className="mb-1.5 mt-3 text-xs font-semibold">{children}</h6>
          ),
          p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              onClick={(ev) => {
                if (!href) return;
                const handled = (onInternalLink ?? defaultInternalLink)(href);
                if (handled !== false) ev.preventDefault();
              }}
              className="font-medium text-primary underline underline-offset-4"
            >
              {children}
            </a>
          ),
          ul: ({ children }) => (
            <ul className="mb-3 list-inside list-disc space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mb-3 list-inside list-decimal space-y-1">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="mb-3 border-l-4 border-muted-foreground/30 pl-3 italic text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-4 border-muted-foreground/30" />,
          code: ({ className, children, ...props }) => (
            <code
              className={`rounded bg-muted px-1.5 py-0.5 font-mono text-xs ${className ?? ''}`}
              {...props}
            >
              {children}
            </code>
          ),
          pre: ({ children }) => (
            <pre className="mb-3 overflow-x-auto rounded-md border bg-muted/50 p-3 text-xs">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mb-3 overflow-x-auto rounded-md border">
              <table className="w-full text-xs">{children}</table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="border-b bg-muted/50">{children}</thead>
          ),
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => (
            <tr className="border-b last:border-0">{children}</tr>
          ),
          th: ({ children }) => (
            <th className="px-3 py-1.5 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="px-3 py-1.5">{children}</td>,
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
