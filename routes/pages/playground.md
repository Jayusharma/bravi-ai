# Page: Playground

## Route
`/playground`

## File Location
`frontend/app/(dashboard)/playground/page.tsx`

## Purpose
Developer test page for experimenting with WebSocket events. **Not for production use.**

## Rendering
Client Component.

## Key Differences from Production Pages
- Connects **directly** to `http://localhost:3001` — bypasses the `/api/socket` token relay
- Connects **without authentication** (no JWT passed in handshake)
- Uses **non-production socket events**: `send-message` and `new-message`

These events (`send-message` / `new-message`) are **not registered** in `MessagingGateway` or `OutboundGateway`. They exist only in the playground page itself — this is a raw test harness, not wired to any backend logic.

## APIs Called
None. Connects directly via `socket.io-client` to `http://localhost:3001`.

## WebSocket Events (playground-only, not in production schema)

| Event          | Direction                  | Notes                                               |
|----------------|----------------------------|-----------------------------------------------------|
| `send-message` | Emitted (client → server)  | Test send; not handled by any production gateway    |
| `new-message`  | Listened (server → client) | Test receive; not emitted by any production gateway |

## Auth & Permissions
- Rendered inside `DashboardLayout`, so session check still applies
- No CASL check on the page content itself
- No nav item in `frontend/lib/navigation.tsx` — not listed in the sidebar
