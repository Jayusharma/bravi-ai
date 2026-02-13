# Implementation Session 1 — What Was Built & How It All Connects

> **Date:** 2026-02-12  
> **Status:** ✅ Backend compiles clean. Frontend builds clean.

---

## Table of Contents

1. [Summary — What Was Done](#1-summary--what-was-done)
2. [Files Created & Modified](#2-files-created--modified)
3. [Feature 1: Database-Driven Permission System](#3-feature-1-database-driven-permission-system)
4. [Feature 2: Expanded Enquiry FSM & Service](#4-feature-2-expanded-enquiry-fsm--service)
5. [Feature 3: API Versioning & Swagger Docs](#5-feature-3-api-versioning--swagger-docs)
6. [Feature 4: Standardized API Responses](#6-feature-4-standardized-api-responses)
7. [Feature 5: Enhanced User Management](#7-feature-5-enhanced-user-management)
8. [Feature 6: Auth Improvements](#8-feature-6-auth-improvements)
9. [Feature 7: Frontend Updates](#9-feature-7-frontend-updates)
10. [Feature 8: Prisma Schema Evolution](#10-feature-8-prisma-schema-evolution)
11. [Complete Request Flow — From Login to Viewing an Enquiry](#11-complete-request-flow--from-login-to-viewing-an-enquiry)
12. [What to Run](#12-what-to-run)
13. [What's Next](#13-whats-next)

---

## 1. Summary — What Was Done

In this session, we implemented the **foundational infrastructure** that every other V1 feature will build on top of. Think of it as laying the plumbing — permissions, API standards, error handling, and data model improvements. Without these, every future feature (notifications, AI qualification, WhatsApp integration) would need to be retrofitted.

### At a Glance

| # | What | Why It Matters |
|---|------|----------------|
| 1 | **DB-driven permission system** (5 files) | Replaces hardcoded `@Roles()`. Permissions live in the database — admin can change who can do what without redeploying code. |
| 2 | **Expanded Enquiry FSM** (7 states, transition rules) | The old 3-state machine (`NEW → OPEN → CLOSED`) couldn't represent real business flow. Now we have `FOLLOW_UP`, `CONVERTED`, `CLOSED_LOST`, etc. |
| 3 | **API versioning** (`/api/v1/` prefix) + Swagger docs | All routes now live under `/api/v1/`. Swagger UI at `/api/docs` for testing. When V2 comes, V1 keeps working. |
| 4 | **Standardized API responses** (filter + interceptor) | Every response is `{ success, data, timestamp }`. Every error is `{ success: false, error: { code, message } }`. Frontend can rely on a single format. |
| 5 | **Enhanced User CRUD** (soft delete, email, display name) | Full user lifecycle: create, update, deactivate (never hard delete), password change. Password never returned in API responses. |
| 6 | **Auth improvements** (`/auth/me`, permissions in login) | Login returns user profile + DB permissions. Frontend can conditionally show/hide UI based on permissions. `/auth/me` for token validation on page refresh. |
| 7 | **Frontend updates** (dashboard, filters, logout) | New dashboard page with KPI stats, enquiry list with search/filter/pagination, logout flow, API path updates. |
| 8 | **Prisma schema evolution** (Permission, RolePermission, User fields, Enquiry fields) | New tables for permissions, new fields on User (email, displayName, isActive, lastLoginAt) and Enquiry (tags, lostReason, firstResponseAt). |

---

## 2. Files Created & Modified

### 🆕 New Files Created

| File | Purpose |
|------|---------|
| `backend/src/modules/permission/permission.service.ts` | Core permission logic — loads DB permissions into memory, checks access |
| `backend/src/modules/permission/permission.guard.ts` | NestJS guard that intercepts every request and checks permissions |
| `backend/src/modules/permission/permission.decorator.ts` | `@CheckPermission()` decorator — marks what permission a route needs |
| `backend/src/modules/permission/permission.controller.ts` | Admin API for managing permissions (grant, revoke, reload cache) |
| `backend/src/modules/permission/permission.module.ts` | NestJS module — `@Global()` so it's available everywhere |
| `backend/src/common/filters/global-exception.filter.ts` | Catches ALL errors, returns standardized format, maps Prisma errors |
| `backend/src/common/interceptors/response.interceptor.ts` | Wraps all successful responses in `{ success: true, data }` |
| `backend/prisma/seed-permissions.ts` | Seeds Permission + RolePermission tables with default rules |
| `frontend/app/dashboard/page.tsx` | Dashboard page with KPI stat cards |
| `frontend/components/LogoutButton.tsx` | Client-side logout button component |
| `frontend/app/api/logout/route.ts` | API route that clears the auth cookie |

### ✏️ Modified Files

| File | What Changed |
|------|-------------|
| `backend/prisma/schema.prisma` | Added `Permission`, `RolePermission` models. Added `email`, `displayName`, `isActive`, `lastLoginAt` to User. Added `tags`, `lostReason`, `firstResponseAt` to Enquiry. Expanded `EnquiryStatus` and `EnquiryEventType` enums. Added indexes. |
| `backend/src/main.ts` | Added `/api/v1/` global prefix, CORS, Swagger setup, global filter + interceptor registration |
| `backend/src/app.module.ts` | Added `PermissionModule`, registered `PermissionGuard` as global guard |
| `backend/src/app.controller.ts` | Added `/health` endpoint |
| `backend/src/modules/enquiry/enquiry.state.ts` | Expanded from 3 states to 7 states with full transition map |
| `backend/src/modules/enquiry/enquiry.service.ts` | Added findAll (filters/search/pagination), getStats, findOne (detail + timeline), updateTags, getMessages. Improved statusChange side effects. |
| `backend/src/modules/enquiry/enquiry.controller.ts` | Rewrote with `@CheckPermission()`, new endpoints (stats, findOne, tags, messages) |
| `backend/src/modules/enquiry/enquiry.module.ts` | Added `exports: [EnquiryService]` |
| `backend/src/modules/enquiry/dto/create-enquiry.dto.ts` | Made `name` optional, added `tags`, `lostReason`. Used Prisma enums. |
| `backend/src/modules/user/user.service.ts` | Added getUserById, updateUser, changePassword, deactivateUser, updateLastLogin. Excludes password from all responses. |
| `backend/src/modules/user/user.controller.ts` | Full CRUD with `@CheckPermission()`, route changed from `/user` to `/users` |
| `backend/src/modules/user/dto/create-user.dto.ts` | Added `email`, `displayName`, `UpdateUserDto`, `ChangePasswordDto` |
| `backend/src/modules/auth/auth.service.ts` | Login returns permissions, checks `isActive`, updates `lastLoginAt`. Added `getProfile`. |
| `backend/src/modules/auth/auth.controller.ts` | Added `GET /auth/me` endpoint |
| `backend/src/modules/auth/auth.module.ts` | Simplified (PermissionService is globally available) |
| `backend/src/modules/auth/dto/login.dto.ts` | Field renamed `UserName` → `userName` |
| `backend/src/common/types/express.d.ts` | Fixed type import to use `UserRole` from Prisma |
| `backend/package.json` | Added `seed:permissions` script, installed `@nestjs/swagger` |
| `frontend/.env` | Updated `NEST_API_URL` to include `/api/v1` prefix |
| `frontend/lib/ServerApi.ts` | Added response envelope unwrapping `{ success, data }` → returns just `data` |
| `frontend/app/login/Login-action.ts` | Updated field name, API URL, response unwrapping |
| `frontend/app/users/page.tsx` | Changed API path from `/user` to `/users` |
| `frontend/app/users/UserClient.tsx` | Updated field names, added role badges, status indicators, enquiry count column |
| `frontend/app/users/actions.ts` | Updated field names and API path |
| `frontend/app/enquiry/page.tsx` | Complete rewrite with search, filters, pagination, status badges, source icons |
| `frontend/components/DashboardLayout.tsx` | Added nav items with icons, branded header, logout button, mobile header |
| `frontend/app/page.tsx` | Updated landing page branding |
| `frontend/app/layout.tsx` | Updated metadata, switched to Inter font |

---

## 3. Feature 1: Database-Driven Permission System

### The Problem It Solves

Before: Permissions were hardcoded decorators like `@Roles('ADMIN', 'SALES')`. To change who can access an endpoint, you had to:
1. Edit the TypeScript code
2. Redeploy the entire backend
3. Hope you didn't break another route

This doesn't scale. When a client says "make the OPS team able to update enquiries too", you don't want to redeploy.

### How It Works

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────────┐
│  Permission  │────▶│  RolePermission  │────▶│  In-Memory Cache     │
│  Table       │     │  Table           │     │  (Map<Role, Perms>)  │
│              │     │                  │     │                      │
│  action      │     │  role: ADMIN     │     │  ADMIN: [manage:all] │
│  subject     │     │  permissionId    │     │  SALES: [read:enquiry│
│              │     │  conditions      │     │         update:enquiry│
│              │     │                  │     │         (conditional)]│
└─────────────┘     └──────────────────┘     └──────────────────────┘
```

### The 5 Files and What Each Does

#### 1. `permission.decorator.ts` — The "Label"
```typescript
@CheckPermission({ action: 'read', subject: 'enquiry' })
```
This decorator is placed on controller methods. It does **nothing** by itself — it just labels the route with metadata saying "this route requires `read` permission on `enquiry`". Think of it like a sticker on a door saying "requires key card level 3".

**When it runs:** Never. It's read by the guard at request time.

#### 2. `permission.guard.ts` — The "Bouncer"
This is the bouncer at the door. On every request:
1. Reads the `@CheckPermission()` metadata from the route
2. If no decorator → lets everyone through (any authenticated user)
3. If decorator exists → asks `PermissionService`: "does this role have this permission?"
4. If yes → let through. If no → throw `ForbiddenException` (403)

**When it runs:** On every HTTP request, AFTER `JwtAuthGuard`. The order matters:
```
Request → JwtAuthGuard (who are you?) → PermissionGuard (can you do this?) → Controller
```

#### 3. `permission.service.ts` — The "Brain"
This is where the actual logic lives. It:
- **On app startup** (`onModuleInit`): loads ALL permissions from the database into a `Map<UserRole, Permission[]>` in memory. This means permission checks are **instant** (no DB query per request).
- **`hasPermission()`**: Checks if a role can do an action on a subject. Supports:
  - **Wildcard action**: `manage` matches any action (used for ADMIN)
  - **Wildcard subject**: `all` matches any subject (used for ADMIN)
  - **Conditions**: `{ assignedToId: "$userId" }` means "only if the resource is assigned to this user" (used for SALES)
- **`loadPermissions()`**: Reloads the cache. Called on startup and when admin changes permissions.
- **`getPermissionsForRole()`**: Returns permissions for a role — sent to the frontend on login so the UI can show/hide buttons.
- **Management methods**: `grantPermission()`, `revokePermission()`, `getAllPermissions()`, `getRolePermissions()` — used by the admin API.

**When it runs:** 
- `onModuleInit()` → when the NestJS app boots up
- `hasPermission()` → on every request (called by the guard)
- Management methods → when admin hits the `/permissions/*` API

#### 4. `permission.controller.ts` — The "Admin Panel API"
Provides endpoints for ADMIN to manage permissions without touching code:
- `GET /permissions` → see all permissions and their role mappings
- `GET /permissions/role/:role` → see what a specific role can do
- `POST /permissions/grant` → give a role a new permission
- `DELETE /permissions/revoke/:id` → take away a permission
- `POST /permissions/reload` → force reload the cache (useful after direct DB edits)

All endpoints require `manage:all` permission (only ADMIN has this).

**When it runs:** Only when an admin explicitly calls these endpoints.

#### 5. `permission.module.ts` — The "Wiring"
A NestJS module marked `@Global()`, which means `PermissionService` and `PermissionGuard` are available in every other module without importing. This is important because:
- `AuthService` needs `PermissionService` to include permissions in the login response
- `PermissionGuard` runs on every request (registered as a global guard in `app.module.ts`)

### The Seed Script — `prisma/seed-permissions.ts`

This script creates the initial data in the `Permission` and `RolePermission` tables. It defines:

| Role | Permissions |
|------|------------|
| **ADMIN** | `manage:all` (full access to everything) |
| **MANAGER** | `read`, `create`, `update`, `assign` on enquiry. `read` on user. `read`, `create` on message. `read` on dashboard. |
| **SALES** | Same as MANAGER but `update:enquiry` has a **condition**: `{ assignedToId: "$userId" }` — meaning SALES can only update enquiries assigned to them |
| **OPS** | Read-only: `read:enquiry`, `read:message`, `read:dashboard` |

**How to run:** `npm run seed:permissions`

### How It Helps the Project

1. **Zero-deploy permission changes**: Admin changes a permission → it takes effect immediately (after cache reload). No redeploy needed.
2. **Granular control**: Instead of "SALES can access the enquiry module", it's "SALES can read enquiries, create enquiries, but only update the ones assigned to them".
3. **Frontend knows what to show**: Login response includes permissions, so the frontend can hide the "Delete" button for SALES users without making failed API calls.
4. **Audit trail ready**: Since permissions are in the DB, you can easily add a `PermissionChangeLog` table later to track who changed what permission when.
5. **Scalable**: Adding a new permission is just an INSERT into the `Permission` table. Adding a new role is just adding new `RolePermission` rows.

---

## 4. Feature 2: Expanded Enquiry FSM & Service

### The Problem It Solves

The old state machine had only 3 states:
```
NEW → OPEN → QUOTATION_SENT → CLOSED
```

This doesn't reflect real business flow. What if a quotation was sent but the customer asks for a follow-up? What if a lead is lost? What if a closed lead comes back?

### The New FSM (7 States)

```
                    ┌──────────────┐
                    │     NEW      │ (just ingested, not reviewed)
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
              ┌────▶│     OPEN     │◀────────────────────────┐
              │     └──┬───┬───┬───┘                         │
              │        │   │   │                             │ (reopen)
              │        │   │   └──────────────┐              │
              │        │   │                  │              │
              │        ▼   ▼                  ▼              │
              │  ┌───────┐ ┌──────────┐  ┌──────────────┐    │
              │  │FOLLOW │ │IN_PROGRESS│  │QUOTATION_SENT│    │
              │  │  UP   │ └──────────┘  └──────┬───────┘    │
              │  └───┬───┘                      │            │
              │      │                          │            │
              │      ▼                          ▼            │
              │  ┌──────────┐            ┌──────────────┐    │
              │  │CONVERTED │            │ CLOSED_LOST  │────┘
              │  │(terminal)│            └──────────────┘
              │  └──────────┘
              │
              └── (various states can go to CLOSED_LOST)
```

**File:** `backend/src/modules/enquiry/enquiry.state.ts`

```typescript
export const ENQUIRY_TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = {
  NEW:            ['OPEN'],
  OPEN:           ['FOLLOW_UP', 'QUOTATION_SENT', 'CONVERTED', 'CLOSED_LOST', 'IN_PROGRESS'],
  IN_PROGRESS:    ['FOLLOW_UP', 'QUOTATION_SENT', 'CONVERTED', 'CLOSED_LOST'],
  FOLLOW_UP:      ['OPEN', 'QUOTATION_SENT', 'CONVERTED', 'CLOSED_LOST'],
  QUOTATION_SENT: ['FOLLOW_UP', 'CONVERTED', 'CLOSED_LOST'],
  CONVERTED:      [],           // Terminal — deal won, no further transitions
  CLOSED_LOST:    ['OPEN'],     // Can reopen a lost lead
};
```

### Enhanced Enquiry Service

**File:** `backend/src/modules/enquiry/enquiry.service.ts`

The service was massively expanded. Here's what each method does and when it's called:

| Method | Triggered By | What It Does |
|--------|-------------|-------------|
| `findAll(filters)` | `GET /enquiry?status=NEW&search=john&page=2` | Fetches enquiries with server-side filtering, search (name, email, phone), and pagination. Returns `{ items, meta: { page, limit, total, totalPages } }`. |
| `getStats()` | `GET /enquiry/stats` | Dashboard KPI numbers: total, new today, unassigned, pending follow-ups, conversion rate (last 30 days), status breakdown (group by status). Uses `Promise.all` for 7 parallel DB queries. |
| `findOne(id)` | `GET /enquiry/:id` | Single enquiry with timeline events (last 50), messages (last 100), assigned user info, and **allowed transitions** based on current status. Frontend uses this to show only valid status buttons. |
| `create(dto)` | `POST /enquiry` | Creates enquiry + initial `CREATED` timeline event in one operation. |
| `createFromMessage()` | Called by `IngestionService` | Creates enquiry from an inbound message (WhatsApp/Email). Sets source and contact info. Used internally, not an API endpoint. |
| `statusChange(id, dto)` | `PATCH /enquiry/:id/status` | The heart of the FSM. Validates transition against `ENQUIRY_TRANSITIONS`. Checks optimistic concurrency (`version`). Schedules/cancels BullMQ automation jobs as side effects. Creates timeline entry. |
| `assign(id, userId, version)` | `PATCH /enquiry/:id/assign` | Assigns or reassigns an enquiry. Tracks previous assignee in timeline metadata. Uses optimistic concurrency. |
| `updateTags(id, tags)` | `PATCH /enquiry/:id/tags` | Sets tags on an enquiry. Calculates added/removed tags and creates individual timeline entries for each change (for audit). |
| `sendMessage(id, dto, actor)` | `POST /enquiry/:id/messages` | Sends a message. Uses a **transaction** (all-or-nothing): create message → create timeline entry → track first response time. Checks `canSendMessage` policy (only assigned user or admin). |
| `getMessages(id)` | `GET /enquiry/:id/messages` | Returns all messages for an enquiry, ordered chronologically. |

### Side Effects on Status Change

When the status changes, the service automatically:

| Target Status | Side Effect |
|---------------|-------------|
| `QUOTATION_SENT` | Schedules a BullMQ follow-up job with **24-hour delay** |
| `FOLLOW_UP` | Schedules a BullMQ follow-up job with **48-hour delay** |
| `CONVERTED` | **Cancels** any pending automation jobs (lead is won, stop bothering) |
| `CLOSED_LOST` | **Cancels** any pending automation jobs + records `lostReason` |
| `OPEN` (from `CLOSED_LOST`) | Logged as `REOPENED` event in timeline |

### How It Helps the Project

1. **No invalid transitions**: Sales can't skip from NEW to CONVERTED. The FSM enforces the flow.
2. **Optimistic concurrency**: If two users try to change the same enquiry, the second one gets a clear `ConflictException` with both versions shown.
3. **Automatic automation**: Status changes automatically schedule/cancel background jobs. No manual intervention needed.
4. **Full audit trail**: Every status change, assignment, tag change, and message is recorded in the timeline with who did it and when.
5. **First response tracking**: The system tracks when the first outbound message was sent (for SLA reporting later).

---

## 5. Feature 3: API Versioning & Swagger Docs

### The Problem It Solves

Without versioning, if you change an API response format, all existing clients break. With `/api/v1/`, you can create `/api/v2/` later while keeping V1 working.

### What Was Done

**File:** `backend/src/main.ts`

```typescript
app.setGlobalPrefix('api/v1');  // All routes now under /api/v1/

// Swagger documentation
const config = new DocumentBuilder()
    .setTitle('Enquiry Management System API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
SwaggerModule.setup('api/docs', app, document);
```

### Route Changes

| Before | After |
|--------|-------|
| `POST /auth/login` | `POST /api/v1/auth/login` |
| `GET /user` | `GET /api/v1/users` |
| `GET /enquiry` | `GET /api/v1/enquiry` |
| `POST /webhook/email` | `POST /api/v1/webhook/email` |
| — | `GET /api/docs` (Swagger UI) |
| — | `GET /api/v1/health` (Health check) |

### How It Helps

1. **Swagger UI at `/api/docs`**: You can test any endpoint directly in the browser without Postman.
2. **Future-proof**: When V2 ships, V1 clients keep working.
3. **Health check**: Deployment monitoring can ping `/api/v1/health` to verify the server is up.

---

## 6. Feature 4: Standardized API Responses

### The Problem It Solves

Before: Some endpoints returned raw data, others returned wrapped data, errors were inconsistent. The frontend couldn't reliably parse responses.

### How It Works — Two Files Working Together

#### 1. `response.interceptor.ts` — Wraps Successes

Every successful response goes through this interceptor:

```
Controller returns { ... } 
        ↓
ResponseInterceptor wraps it 
        ↓
Client receives { success: true, data: { ... }, timestamp: "..." }
```

#### 2. `global-exception.filter.ts` — Wraps Errors

Every error (thrown anywhere in the app) goes through this filter:

```
Service throws NotFoundException("Enquiry not found")
        ↓
GlobalExceptionFilter catches it
        ↓
Client receives { success: false, error: { code: "NOT_FOUND", message: "Enquiry not found", statusCode: 404 } }
```

**Special handling:**
- **Validation errors** (class-validator): `{ code: "VALIDATION_ERROR", details: ["name must be a string", "email must be valid"] }`
- **Prisma P2002** (duplicate): `{ code: "DUPLICATE_ENTRY", message: "A record with this email already exists" }`
- **Prisma P2025** (not found): `{ code: "NOT_FOUND", message: "Record not found" }`
- **Prisma P2003** (foreign key): `{ code: "FOREIGN_KEY_ERROR", message: "Related record not found" }`

### Frontend Counterpart

**File:** `frontend/lib/ServerApi.ts`

The `serverFetch()` function now automatically unwraps the envelope:

```typescript
const json = await res.json();

// Unwrap: { success: true, data: { ... } } → returns just data
if (json && 'success' in json && 'data' in json) {
    return json.data;
}
```

For errors, it parses the structured error message:

```typescript
const errorBody = await res.json();
if (errorBody?.error?.message) {
    throw new Error(errorBody.error.message);  // "Enquiry not found" instead of raw 404
}
```

### How It Helps

1. **Frontend simplicity**: `const users = await serverFetch('/users')` — always returns the data directly, envelope is handled.
2. **Consistent error handling**: Frontend can always check `error.message` for a human-readable string.
3. **Debugging**: Every response includes a `timestamp`, every error includes `path` and `code`.

---

## 7. Feature 5: Enhanced User Management

### Files Involved

| File | Role |
|------|------|
| `backend/src/modules/user/user.service.ts` | Business logic |
| `backend/src/modules/user/user.controller.ts` | HTTP endpoints |
| `backend/src/modules/user/dto/create-user.dto.ts` | Validation rules |

### New Capabilities

| Endpoint | What It Does | Who Can Use It |
|----------|-------------|----------------|
| `GET /api/v1/users` | List all users with role, status, assignee count (password excluded) | `read:user` (ADMIN, MANAGER) |
| `GET /api/v1/users/:id` | Single user details | `read:user` |
| `POST /api/v1/users` | Create user with email, displayName, role | `create:user` (ADMIN only) |
| `PATCH /api/v1/users/:id` | Update role, displayName, email, isActive | `update:user` (ADMIN only) |
| `PATCH /api/v1/users/:id/password` | Change password (min 8 chars) | `update:user` |
| `DELETE /api/v1/users/:id` | Soft-delete (sets `isActive = false`) | `delete:user` (ADMIN only) |

### Key Design Decisions

1. **Never hard-delete users**: Setting `isActive = false` keeps all historical data (who assigned what enquiry, who sent what message) intact.
2. **Password never in responses**: All queries use `select: { password: false, ... }` to ensure passwords are never accidentally sent to the client.
3. **Unique email check**: Creating a user with a duplicate email returns a clear "Email already in use" error instead of a cryptic Prisma error.
4. **Enquiry count in listing**: User list includes `_count: { assignedEnquiries }` so managers can see who has the most workload.

---

## 8. Feature 6: Auth Improvements

### Files Involved

| File | Role |
|------|------|
| `backend/src/modules/auth/auth.service.ts` | Login logic + profile |
| `backend/src/modules/auth/auth.controller.ts` | `/auth/login` + `/auth/me` |
| `backend/src/modules/auth/dto/login.dto.ts` | Login DTO |

### What Changed

#### Login Response Now Includes Permissions

Before:
```json
{ "access_token": "eyJhbGci..." }
```

After:
```json
{
  "access_token": "eyJhbGci...",
  "user": {
    "id": "uuid",
    "userName": "admin",
    "email": "admin@example.com",
    "displayName": "Admin",
    "role": "ADMIN"
  },
  "permissions": [
    { "action": "manage", "subject": "all", "conditions": null }
  ]
}
```

The frontend can now use `permissions` to show/hide UI elements:
```
if user has "create:user" → show "Add User" button
if user has "assign:enquiry" → show "Assign" dropdown
if user has "delete:user" → show "Delete" button
```

#### `/auth/me` Endpoint

```
GET /api/v1/auth/me
Authorization: Bearer <token>
```

Returns the current user's profile + permissions. Used by the frontend when:
- The page refreshes and needs to verify the token is still valid
- The app loads and needs to know what to show in the sidebar
- Permissions may have changed since login

#### Login Validations

1. **User not found** → "Invalid credentials" (doesn't reveal that the username is wrong)
2. **Wrong password** → "Invalid credentials" (same message, no hint)
3. **Deactivated account** → "Account is deactivated. Contact admin." (clear feedback)
4. **Successful login** → updates `lastLoginAt` timestamp on the user record

---

## 9. Feature 7: Frontend Updates

### New Dashboard Page

**File:** `frontend/app/dashboard/page.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│  Dashboard                                                   │
│  Overview of your enquiry pipeline                           │
│                                                              │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐          │
│  │  📋  │  │  🆕  │  │  ⚠️  │  │  🔔  │  │  📈  │          │
│  │ 156  │  │  12  │  │   5  │  │   3  │  │ 23%  │          │
│  │Total │  │ New  │  │Unas- │  │Pend- │  │Conv. │          │
│  │      │  │Today │  │signed│  │ing   │  │Rate  │          │
│  └──────┘  └──────┘  └──────┘  └──────┘  └──────┘          │
│                                                              │
│  Status Breakdown                                            │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │ 🔵 New: 12   │ 🟢 Open: 45  │ 🟡 Follow: 3 │             │
│  └──────────────┴──────────────┴──────────────┘             │
│                                                              │
│  Quick Actions                                               │
│  ┌──────────────┬──────────────┬──────────────┐             │
│  │📋 View All   │👥 Manage     │🆕 New        │             │
│  │  Enquiries   │  Users       │  Enquiries   │             │
│  └──────────────┴──────────────┴──────────────┘             │
└─────────────────────────────────────────────────────────────┘
```

### Enhanced Enquiry List

**File:** `frontend/app/enquiry/page.tsx`

New features:
- **Search**: Text search across name, email, phone
- **Status filter**: Dropdown with all 7 statuses
- **Source filter**: Dropdown (WhatsApp, Email, Manual, Web)
- **Color-coded status badges**: Each status has a unique color
- **Source icons**: 💬 WhatsApp, 📧 Email, ✍️ Manual, 🌐 Web
- **Assigned To column**: Shows who's handling the enquiry (or "Unassigned" in italic)
- **Pagination**: Previous/Next buttons with page count
- **Query string filters**: `?status=NEW&source=EMAIL&search=john&page=2`

### Updated Sidebar

**File:** `frontend/components/DashboardLayout.tsx`

```
┌────────────────┐
│  📩 Enquiry Hub │
│  Management v1  │
├────────────────┤
│  📊 Dashboard   │
│  📋 Enquiries   │
│  👥 Users       │
├────────────────┤
│  🚪 Logout      │
└────────────────┘
```

Added: branded header, icon-based navigation, logout button, mobile-responsive header.

### Logout Flow

1. User clicks "Logout" button (`frontend/components/LogoutButton.tsx`)
2. Button calls `POST /api/logout` (Next.js API route)
3. API route (`frontend/app/api/logout/route.ts`) calls `clearAuthToken()` which deletes the HttpOnly cookie
4. User is redirected to `/login`

---

## 10. Feature 8: Prisma Schema Evolution

### New Models Added

#### `Permission` Table
```
| id (uuid) | action          | subject    |
|-----------|-----------------|------------|
| abc-123   | "create"        | "enquiry"  |
| abc-124   | "read"          | "enquiry"  |
| abc-125   | "manage"        | "all"      |
| ...       | 6 actions × 5 subjects = 30 rows |
```

#### `RolePermission` Table
```
| id | role    | permissionId | conditions                        |
|----|---------|-------------|-----------------------------------|
| x1 | ADMIN   | abc-125     | null (manage:all, no conditions)  |
| x2 | SALES   | abc-124     | null (read:enquiry, any enquiry)  |
| x3 | SALES   | abc-128     | { "assignedToId": "$userId" }     |
|    |         |             | (update:enquiry, only assigned)   |
```

### User Table Changes

| Field | Before | After | Why |
|-------|--------|-------|-----|
| `UserName` | `String @unique` | `userName @map("UserName")` | camelCase in code, DB column unchanged |
| `email` | ❌ didn't exist | `String? @unique` | Users need email for notifications |
| `displayName` | ❌ didn't exist | `String?` | Show friendly name instead of username |
| `isActive` | ❌ didn't exist | `Boolean @default(true)` | Soft-delete support |
| `lastLoginAt` | ❌ didn't exist | `DateTime?` | Track login activity |

### Enquiry Table Changes

| Field | Before | After | Why |
|-------|--------|-------|-----|
| `tags` | ❌ didn't exist | `String[] @default([])` | Categorize enquiries (Urgent, VIP, etc.) |
| `lostReason` | ❌ didn't exist | `String?` | Record why a lead was lost |
| `firstResponseAt` | ❌ didn't exist | `DateTime?` | Track SLA / response time |
| `lastCustomerReplyAt` | existed but unused | kept | Track customer engagement |

### EnquiryStatus Enum

| Before | After |
|--------|-------|
| `NEW` | `NEW` |
| `OPEN` | `OPEN` |
| `QUOTATION_SENT` | `IN_PROGRESS` (new) |
| `CLOSED` | `QUOTATION_SENT` |
|  | `FOLLOW_UP` (new) |
|  | `CONVERTED` (new) |
|  | `CLOSED_LOST` (new) |

### EnquiryEventType Enum (expanded)

Added: `REASSIGNED`, `FOLLOWUP_SENT`, `FOLLOWUP_SCHEDULED`, `CUSTOMER_REPLIED`, `MESSAGE_SENT`, `MESSAGE_RECEIVED`, `ESCALATED`, `TAG_ADDED`, `TAG_REMOVED`, `CONVERTED`, `CLOSED`, `REOPENED`

---

## 11. Complete Request Flow — From Login to Viewing an Enquiry

Here's exactly what happens step by step when a SALES user logs in and views an enquiry:

### Step 1: Login

```
Browser → POST /api/v1/auth/login { userName: "john", password: "secret123" }
```

1. `LoginAction` (Next.js server action) receives form data
2. Sends request to NestJS backend
3. `AuthController.login()` → `AuthService.login()`
4. AuthService:
   - Finds user by `userName`
   - Checks `isActive` is `true`
   - Compares bcrypt password hash
   - Updates `lastLoginAt`
   - Signs JWT with `{ sub: userId, role: "SALES" }`
   - Gets permissions from `PermissionService.getPermissionsForRole("SALES")`
   - Returns `{ access_token, user, permissions }`
5. `ResponseInterceptor` wraps in `{ success: true, data: { access_token, ... } }`
6. `LoginAction` unwraps the envelope, stores JWT in HttpOnly cookie
7. Redirects to `/dashboard`

### Step 2: Dashboard

```
Browser → GET /dashboard (Next.js page)
```

1. Next.js server component calls `serverFetch('/enquiry/stats')`
2. `serverFetch` reads JWT from cookie, attaches `Authorization: Bearer <token>`
3. Request hits NestJS: `GET /api/v1/enquiry/stats`
4. **JwtAuthGuard** validates JWT, extracts `{ userId, role: "SALES" }`
5. **PermissionGuard** reads `@CheckPermission({ action: 'read', subject: 'dashboard' })`
6. `PermissionService.hasPermission("SALES", "read", "dashboard")` → checks cache → SALES has `read:dashboard` → **allowed**
7. `EnquiryService.getStats()` runs 7 parallel queries
8. Returns `{ totalEnquiries, newToday, unassigned, ... }`
9. `ResponseInterceptor` wraps → `{ success: true, data: { ... } }`
10. `serverFetch` unwraps → returns just the data
11. Dashboard page renders KPI cards

### Step 3: View Enquiry List with Filters

```
Browser → GET /enquiry?status=OPEN&search=smith (Next.js page)
```

1. Page component calls `serverFetch('/enquiry?status=OPEN&search=smith&page=1&limit=20')`
2. Hits `EnquiryController.findAll()` with query params
3. Guards pass (SALES has `read:enquiry`)
4. `EnquiryService.findAll({ status: "OPEN", search: "smith", page: 1, limit: 20 })`
5. Builds Prisma `where`:
   ```
   { status: "OPEN", OR: [{ name: { contains: "smith" } }, { email: { contains: "smith" } }] }
   ```
6. Runs `findMany` + `count` in parallel
7. Returns `{ items: [...], meta: { page: 1, total: 3, totalPages: 1 } }`
8. Frontend renders filtered table with color badges and pagination

### Step 4: Attempting Something Forbidden

```
SALES user tries → DELETE /api/v1/users/abc-123
```

1. `JwtAuthGuard` → passes (token is valid)
2. `PermissionGuard` → reads `@CheckPermission({ action: 'delete', subject: 'user' })`
3. `PermissionService.hasPermission("SALES", "delete", "user")` → scans SALES permissions → no match found → **denied**
4. Guard throws `ForbiddenException("You do not have permission to delete user")`
5. `GlobalExceptionFilter` catches it → `{ success: false, error: { code: "FORBIDDEN", message: "You do not have permission to delete user", statusCode: 403 } }`

---

## 12. What to Run

### First Time Setup (after this session)

```bash
# 1. Generate Prisma client (already done, but required after schema changes)
cd backend
npx prisma generate

# 2. Create a migration for the new schema
npx prisma migrate dev --name "add-permissions-and-enhance-models"

# 3. Seed the permission tables
npm run seed:permissions

# 4. Start the backend
npm run start:dev
# Server at http://localhost:3001
# Swagger at http://localhost:3001/api/docs

# 5. Start the frontend (in another terminal)
cd frontend
npm run dev
# Frontend at http://localhost:3000
```

### Verify It's Working

1. Open `http://localhost:3001/api/docs` → you should see Swagger UI
2. Open `http://localhost:3001/api/v1/health` → `{ "status": "ok", ... }`
3. Login via the frontend → you should be redirected to `/dashboard`
4. Check the console → should see `✅ Permissions loaded: X rules for Y roles`

---

## 13. What's Next

These foundational pieces are now in place. The next features to implement from `VERSION_1_FEATURES.md` are:

| Priority | Feature | Depends On (from this session) |
|----------|---------|-------------------------------|
| 1 | **WhatsApp webhook** (4.1.2) | API versioning, ingestion pipeline |
| 2 | **AI-powered lead qualification** (4.2) | Ingestion pipeline, message model |
| 3 | **Notification system** (4.9) | Permission system, event timeline |
| 4 | **Enquiry detail view** (4.7) | findOne endpoint (done), timeline (done) |
| 5 | **Automation engine expansion** (4.8) | FSM side effects (done), BullMQ |
| 6 | **Security hardening** (4.12) | Auth improvements (done) |

Everything built in this session is the **plumbing** that makes all of these features possible without refactoring the core.
