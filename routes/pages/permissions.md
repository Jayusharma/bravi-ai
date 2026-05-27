# Page: Permissions (Access Control)

## Route
`/permissions`

## File Location
`frontend/app/(dashboard)/permissions/page.tsx`

## Purpose
RBAC management UI. Shows a permission matrix across roles (`ADMIN`, `MANAGER`, `SALES`, `OPS`) and all subjects. Allows bulk-assigning CRUD actions to roles and clearing all assignments for a role.

## Rendering
Server Component — permission data fetched at request time.

## Components Used

| Component      | File                                           | Role                               |
|----------------|------------------------------------------------|------------------------------------|
| `<Permission>` | `frontend/components/dashboard/permission.tsx` | Interactive permission matrix grid |

## APIs Called

| Method | Endpoint                                | Service Function          | Notes                                         |
|--------|-----------------------------------------|---------------------------|-----------------------------------------------|
| GET    | `/api/v1/permissions`                   | `getPermissions()`        | All permission definitions                    |
| GET    | `/api/v1/permissions/roles/all`         | `getRoleAssignments()`    | All role → permission mappings                |
| POST   | `/api/v1/permissions/roles/bulk-assign` | `bulkAssignPermissions()` | Assign multiple permissions to a role at once |
| DELETE | `/api/v1/permissions/roles/:role/clear` | `clearRolePermissions()`  | Remove all permissions from a role            |

## Roles
From `UserRole` Prisma enum: `ADMIN` | `MANAGER` | `SALES` | `OPS`

## CASL Permission Model
```
Permission { action, subject }
  └── RolePermission { role, permissionId, conditions? }
        └── Loaded at login → returned in /auth/me → stored in AuthStore → CASL ability built
```

- Backend: `CaslAbilityFactory.createForUser()` reads `RolePermission` records from DB
- Frontend: `AuthHydrator` → `useAuthStore().setSession()` → `buildAbility()` rebuilds CASL on client
- Condition support: `conditions` field on `RolePermission` supports `$userId` placeholder (resolved to requesting user's ID at runtime)

## WebSocket Events
None.

## State Management
No client-side state; the `<Permission>` component manages its own local form state for the matrix checkboxes.

## Auth & Permissions
- Protected by `DashboardLayout`
- CASL required: `read:permission` to view
- Sidebar nav item uses `{ action: 'read', subject: 'permission' }` from `frontend/lib/navigation.tsx`
- Bulk assign requires: `create:permission`
- Clear role requires: `delete:permission`

## Backend Note
`CaslGuard` is commented out at class level on `PermissionController` — individual method-level decorators still apply, but the class-level guard is not active.
