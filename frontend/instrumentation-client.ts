// instrumentation-client.ts — Sentry client (browser) init.
// Next.js loads this automatically before any client code runs. This ONLY configures the
// Sentry client — it does not catch anything by itself. The actual capture points are:
//   1. Sentry.ErrorBoundary in app/layout.tsx — render-time errors in the React tree.
//   2. Sentry.captureException in lib/api-client.ts — failed API requests.
// No tracing, no session replay, no auto-instrumentation — deliberately just error capture.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
