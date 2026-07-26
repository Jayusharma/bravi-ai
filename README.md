# FirstReply — AI-Powered Unified Inbox & Lead Automation

One inbox for every channel. Every lead qualified by AI. No lead ever waits more than 90 seconds.

> Production system — core code is private. This repo documents the architecture, features, and design decisions.


## The problem
Businesses lose leads because messages scatter across WhatsApp, Instagram, and email — and nobody replies in the first minutes when a lead is hot.

## What FirstReply does
- **Unified inbox** — WhatsApp, Instagram, and email consolidated into one real-time stream. Pluggable channel adapters, toggled live from an admin panel with zero redeploys.
- **AI qualification** — every inbound lead is scored on confidence by an LLM pipeline and auto-routed into separate **qualified / needs-review / spam** inboxes, so the team reviews what matters.
- **90-second no-response guard** — if no human replies in time, AI responds from approved templates via BullMQ-scheduled jobs. Cancelled instantly if a human replies first.
- **Idempotent ingestion** — webhook retries never create duplicate messages. Media handled on Cloudflare R2.
- **Permission matrix** — CASL-based per-action access control across contacts, channels, and campaigns.

## Architecture
```
WhatsApp / Instagram / Email
        │  (webhooks, idempotency keys)
        ▼
┌─────────────────┐     jobs      ┌──────────────────────┐
│   NestJS core    │ ───────────▶ │  Python AI service    │
│  channel adapters│    BullMQ     │  Gemini · scoring ·   │
│  inbox · CASL    │ ◀─────────── │  reply generation     │
└─────────────────┘    Redis      └──────────────────────┘
        │ Socket.io
        ▼
   Next.js dashboard (real-time inbox)
```
AI workloads run in an isolated Python microservice — LLM latency never blocks the inbox.

**Stack:** NestJS · Next.js · Python · Gemini · PostgreSQL · Prisma · BullMQ · Redis · Socket.io · Cloudflare R2 · Twilio · SendGrid

## Design decisions
- **Confidence thresholds over binary classification** — leads route to a needs-review inbox instead of being silently mis-sorted; humans only touch edge cases.
- **Queue-first AI** — every LLM call is an async BullMQ job with retries and fallbacks; a slow or failed model call never blocks message delivery.
- **Adapters over integrations** — each channel implements one interface, so adding a new channel touches zero core code.

## Roadmap (in progress)
- RAG-grounded reply drafting over a per-business knowledge base (pgvector)
- Agentic copilot — ask the system anything about leads, sales, and channels; acts within CASL permission scopes
- Voice agent over WebRTC


