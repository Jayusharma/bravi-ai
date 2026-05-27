# Page: Enquiry List

## Route
`/enquiry`

## File Location
`frontend/app/(dashboard)/enquiry/page.tsx`

## Purpose
Server-rendered inbox showing all enquiries with filters (status, assignee, search) and aggregate stats. Each row links to `/enquiry/[id]`.

## Rendering
Server Component — data fetched at request time, no client-side hydration for the list itself.

## Components Used

| Component     | File                 | Role                                      |
|---------------|----------------------|-------------------------------------------|
| Enquiry table | inline in `page.tsx` | Renders rows from `getEnquiries()` result |
| Stats bar     | inline in `page.tsx` | Shows counts from `getEnquiryStats()`     |

## APIs Called

| Method | Endpoint                | Service Function                                                        | Query Params                                              |
|--------|-------------------------|-------------------------------------------------------------------------|-----------------------------------------------------------|
| GET    | `/api/v1/enquiry`       | `getEnquiries()` in `frontend/services/messaging/enquiry.service.ts`    | `status, assignedTo, search, page, limit` (InboxQueryDto) |
| GET    | `/api/v1/enquiry/stats` | `getEnquiryStats()` in `frontend/services/messaging/enquiry.service.ts` | —                                                         |

## Enquiry Statuses
From `EnquiryStatus` Prisma enum:
`NEW` | `OPEN` | `IN_PROGRESS` | `AWAITING_CUSTOMER` | `QUOTATION_SENT` | `FOLLOW_UP` | `STALE` | `CONVERTED` | `CLOSED_LOST`

## Navigation
- Each enquiry row links to `/enquiry/[id]` (enquiry detail page)
- Sidebar nav item shown when `can('read', 'enquiry')` is true

## WebSocket Events
None — this page does not subscribe to real-time updates. The list is static until the user refreshes or navigates.

## State Management
No client-side state on this page (server component). Filters are applied via URL search params that trigger a new server render.

## Auth & Permissions
- Protected by `DashboardLayout` (session check + redirect)
- CASL required: `read:enquiry`
- Sidebar entry: `{ action: 'read', subject: 'enquiry' }` in `frontend/lib/navigation.tsx`
