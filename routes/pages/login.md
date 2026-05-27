# Page: Login

## Route
`/auth/login`

## File Location
`frontend/app/auth/login/page.tsx`

## Purpose
Authentication entry point. Redirects authenticated users away before rendering; unauthenticated users see the login form.

## Redirect Logic
```
page.tsx (server component)
  └─ getCurrentUser()         ← reads access_token HttpOnly cookie → GET /api/v1/auth/me
       ├─ user found  →  redirect('/dashboard')
       └─ no user    →  render <LoginForm />
```

## Components Used

| Component     | File                                     | Role                                     |
|---------------|------------------------------------------|------------------------------------------|
| `<LoginForm>` | `frontend/components/auth/LoginForm.tsx` | Username + password form, submit handler |

## APIs Called

| Method | Endpoint             | Called By                                                    | Notes                                                                    |
|--------|----------------------|--------------------------------------------------------------|--------------------------------------------------------------------------|
| POST   | `/api/v1/auth/login` | `frontend/services/auth/login.service.ts → login()`          | Body: `{ userName, password }`. Returns `{ user, permissions[], token }` |
| GET    | `/api/v1/auth/me`    | `frontend/services/auth/login.service.ts → getCurrentUser()` | Used on load to check existing session                                   |

## Auth Flow Detail
```
LoginForm.submit()
  → login(userName, password)       ← Server Action
       → POST /api/v1/auth/login
       → setAuthToken(token)         ← writes HttpOnly cookie (30 days, sameSite: lax)
       → redirect('/dashboard')
```

## Cookie
- Name: `process.env.AUTH_COOKIE_NAME`
- Flags: `httpOnly: true`, `sameSite: lax`, `secure: false` (set to `true` in production)
- TTL: 30 days (matches backend JWT expiry)
- **Set in:** `frontend/lib/Auth.ts → setAuthToken()`
- **Read in:** `frontend/lib/Auth.ts → getAuthToken()` (used by `apiClient` for Bearer header)

## WebSocket Events
None — login page does not establish a socket connection.

## State Management
No Zustand store used on this page. Auth store hydration happens at the dashboard layout level (`DashboardLayout` → `AuthHydrator`).

## Auth & Permissions
- No CASL check required — page is publicly accessible
- Redirects away if already authenticated
