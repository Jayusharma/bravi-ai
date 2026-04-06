# Permission System Frontend/Backend Map

## Backend source of truth

- Prisma roles are defined in `backend/prisma/schema.prisma` as `ADMIN`, `MANAGER`, `SALES`, and `OPS`.
- Frontend mirrors the same values in `frontend/lib/roles.ts`.
- Permissions are stored as `action + subject` rows in `Permission`.
- Role assignments are stored in `RolePermission`.

## Subject creation flow

- Inventory page: `/permissions`
- When a new subject is created from the frontend, the backend calls `POST /permissions/subjects`.
- The backend automatically creates these permissions for that subject:
  - `create`
  - `read`
  - `update`
  - `delete`

This keeps the permission matrix predictable and avoids manually creating the standard CRUD set every time.

## Role assignment flow

- Assignment page: `/permissions/assignments`
- User selects one Prisma role first.
- The UI renders one row per subject and four checkbox columns:
  - `create`
  - `read`
  - `update`
  - `delete`
- On save, the frontend clears that role's existing assignments and reassigns the selected permission IDs.
- Non-CRUD permissions such as advanced rules are preserved outside the matrix.

## Navigation location

- Main navigation config lives in `frontend/lib/navigation.tsx`.
- Add future modules there so sidebar visibility stays permission-aware.

## Login and dashboard flow

- `/` redirects to `/dashboard` when authenticated, otherwise to `/auth/login`.
- `/login` is kept as a compatibility redirect to `/auth/login`.
- Authenticated dashboard routes redirect back to login if the session is missing.

## Hydration fix

- Theme state now hydrates after mount instead of reading `localStorage` during initial render.
- Sidebar pinned state also loads after mount.
- This removes the common server/client mismatch that was surfacing around the theme toggle.
