// sentry.server.config.ts — Sentry server (Node) init.
// A SEPARATE runtime from the browser — instrumentation-client.ts does NOT cover this.
// lib/api-client.ts runs exclusively server-side (Server Actions), so its
// Sentry.captureException calls only go anywhere because this file initialized the
// server-side client. Registered by instrumentation.ts below; Next.js does not load
// this file automatically on its own.
// Reuses NEXT_PUBLIC_SENTRY_DSN — a Sentry DSN isn't a secret (it's meant to be embedded
// in a public browser bundle), so one var covers both runtimes.
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
});
