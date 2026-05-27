# Page: Enquiry Detail

## Route
`/enquiry/[id]`

## File Locations
- Server component: `frontend/app/(dashboard)/enquiry/[id]/page.tsx`
- Client component: `frontend/app/(dashboard)/enquiry/[id]/EnquiryDetailClient.tsx`

## Purpose
Full detail view for a single enquiry. Shows the enquiry header (status, assignee, tags), outbound message history, and a composer for sending new messages. Receives real-time delivery updates via WebSocket.

## Data Loading (Server Component)

Parallel server-side fetches on every page load:
```typescript
const [enquiry, draft, messages] = await Promise.all([
  getEnquiry(id),
  getActiveDraft(id),
  getOutboundMessages(id),
]);
```

| Method | Endpoint                                         | Service Function                                                               | Notes                          |
|--------|--------------------------------------------------|--------------------------------------------------------------------------------|--------------------------------|
| GET    | `/api/v1/enquiry/:id`                            | `getEnquiry(id)` in `frontend/services/messaging/enquiry.service.ts`           | Full enquiry detail            |
| GET    | `/api/v1/outbound/enquiries/:enquiryId/draft`    | `getActiveDraft(id)` in `frontend/services/messaging/outbound.service.ts`      | Active `ACTIVE` draft, or null |
| GET    | `/api/v1/outbound/enquiries/:enquiryId/messages` | `getOutboundMessages(id)` in `frontend/services/messaging/outbound.service.ts` | Sent/failed outbound messages  |

## Components Used

| Component               | File                                                            | Role                                                             |
|-------------------------|-----------------------------------------------------------------|------------------------------------------------------------------|
| `<EnquiryDetailClient>` | `frontend/app/(dashboard)/enquiry/[id]/EnquiryDetailClient.tsx` | Client shell; owns socket room join/leave                        |
| `<OutboundHistory>`     | `frontend/components/outbound/OutboundHistory.tsx`              | Shows outbound message thread with delivery badges               |
| `<OutboundComposer>`    | `frontend/components/outbound/OutboundComposer.tsx`             | Draft editor with channel selector, auto-save, send confirmation |

## WebSocket Events

### Emitted (client → server)
| Event           | When                             | Payload         |
|-----------------|----------------------------------|-----------------|
| `enquiry:join`  | On mount (EnquiryDetailClient)   | `{ enquiryId }` |
| `enquiry:leave` | On unmount (EnquiryDetailClient) | `{ enquiryId }` |

### Subscribed (server → client)
| Event                       | Handler Component                        | Effect                                          |
|-----------------------------|------------------------------------------|-------------------------------------------------|
| `outbound:sent`             | `EnquiryDetailClient`, `OutboundHistory` | Add new message to history                      |
| `outbound:delivery_updated` | `EnquiryDetailClient`, `OutboundHistory` | Update delivery badge (SENT → DELIVERED → READ) |
| `outbound:failed`           | `OutboundHistory`                        | Show FAILED badge + retry button                |

## Outbound Composer Behavior (`OutboundComposer`)

```
User edits draft body
  → auto-save after 30s of inactivity
       → PATCH /api/v1/outbound/drafts/:draftId

User clicks Send
  → <ConfirmSendDialog> shown
  → confirm → POST /api/v1/outbound/drafts/:draftId/send
  → on success: clear local draft state
  → real-time update arrives via outbound:sent WS event
```

## State Management
- Draft state managed locally in `OutboundComposer`
- Message list updated via WS events in `EnquiryDetailClient`
- No Zustand usage beyond the auth store (permissions check)

## Auth & Permissions
- Protected by `DashboardLayout`
- CASL required: `read:enquiry` to view
- CASL required: `create:conversationmessage` to send
- CASL required: `read:outbounddraft` to load draft
