// instrumentation.ts — Next.js's own hook for loading runtime-specific setup at server start.
// Only wires up the Node runtime — nothing in this app runs on the edge runtime (no
// middleware.ts, no edge API routes), so there's no sentry.edge.config.ts to load.
//
// Deliberately NOT exporting `onRequestError` here (Sentry's quickstart suggests
// `export const onRequestError = Sentry.captureRequestError`, which auto-captures errors
// from Next.js's internal request lifecycle). That's auto-instrumentation — skipped on
// purpose, same reasoning as the backend: exactly two explicit capture call sites
// (Sentry.ErrorBoundary in app/layout.tsx, Sentry.captureException in lib/api-client.ts),
// nothing implicit.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}
