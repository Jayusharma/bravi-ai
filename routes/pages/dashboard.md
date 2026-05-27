# Page: Dashboard

## Route
`/dashboard`

## File Location
`frontend/app/(dashboard)/dashboard/page.tsx`

## Purpose
Main landing page after login. Currently a placeholder — no data or components beyond the shell layout.

## Layout
Rendered inside `frontend/app/(dashboard)/layout.tsx` → `DashboardLayout`:
```
DashboardLayout (server component)
  └─ getCurrentUser() → verify session or redirect to /auth/login
  └─ AuthHydrator    → hydrate Zustand auth store (client)
  └─ SidebarClient   → dashboard shell with resizable sidebar
       └─ <children> → dashboard/page.tsx content
```

## Components Used
Only the shared shell (`SidebarClient`). The page itself renders a placeholder UI.

## APIs Called
None directly from this page. `DashboardLayout` calls:

| Method | Endpoint | Called By | Notes |
|--------|----------|-----------|-------|
| GET | `/api/v1/auth/me` | `getCurrentUser()` in `DashboardLayout` | Returns user + permissions for store hydration |

## WebSocket Events
None — dashboard page does not subscribe to any socket events.

## State Management
Auth store (`frontend/stores/auth-store.ts`) is hydrated by `AuthHydrator` in the parent layout. All client components under `(dashboard)/` can then call `useAuthStore().can(action, subject)`.

## Auth & Permissions
- Protected by `DashboardLayout` — redirects to `/auth/login` if no valid session
- CASL: nav item requires `read:dashboard` permission to appear in sidebar
- Sidebar items visibility controlled by `frontend/lib/navigation.tsx` → checked against `useAuthStore().can()`
