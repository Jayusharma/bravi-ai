# Page: Messaging

## Route
`/messaging`

## File Location
`frontend/app/(dashboard)/messaging/page.tsx`

## Purpose
WhatsApp-style two-pane chat interface. Left pane: scrollable contact list with unread badges and draft previews. Right pane: full thread view with inline composer, attachment support, reactions, typing indicators, and real-time delivery tracking.

## Rendering
Client Component (`'use client'`). Data loaded on mount; socket lifecycle managed directly in the page component.

## Layout Structure
```
MessagingPage
  ├─ <ContactList>          ← left pane
  ├─ <ChatView>             ← right pane (null until a contact is selected)
  └─ <MessageToast>         ← floating toast for new messages from other contacts
```

## Components Used

| Component             | File                                                      | Role                                                                  |
|-----------------------|-----------------------------------------------------------|-----------------------------------------------------------------------|
| `<ContactList>`       | `frontend/components/dashboard/Messaging/ContactList.tsx` | Loads and displays conversations, subscribes to `contact-list:update` |
| `<ChatView>`          | `frontend/components/dashboard/Messaging/ChatView.tsx`    | Full chat thread + `InlineComposer` sub-component                     |
| `<MessageToast>`      | `frontend/components/messaging/MessageToast.tsx`          | Toast for messages from non-active contacts                           |
| `<AttachmentPreview>` | `frontend/components/messaging/AttachmentPreview.tsx`     | Preview thumbnails for attachments in thread                          |
| `<ImageLightbox>`     | `frontend/components/messaging/ImageLightbox.tsx`         | Full-screen image viewer                                              |

## APIs Called

| Method | Endpoint                                           | Service Function                                 | When                                        |
|--------|----------------------------------------------------|--------------------------------------------------|---------------------------------------------|
| GET    | `/api/v1/conversations`                            | `getConversations()`                             | ContactList mount + search debounce (300ms) |
| GET    | `/api/v1/conversations/:contactId/thread`          | `getConversationThread(contactId)`               | When user selects a contact                 |
| POST   | `/api/v1/outbound/enquiries/:enquiryId/drafts`     | `createDraft()`                                  | When InlineComposer first needs a draft     |
| PATCH  | `/api/v1/outbound/drafts/:draftId`                 | `updateDraft()`                                  | Auto-save on body change (debounced)        |
| POST   | `/api/v1/outbound/drafts/:draftId/send`            | `sendDraft()`                                    | User clicks send                            |
| POST   | `/api/v1/outbound/drafts/:draftId/attachments`     | `uploadAttachment()` in `frontend/lib/upload.ts` | File selected in attachment menu            |
| DELETE | `/api/v1/outbound/drafts/:draftId/attachments/:id` | `deleteDraftAttachment()`                        | User removes attachment from preview        |

## File Upload Flow
```
User picks file via attachment menu
  → useUpload(draftId) hook adds file to queue
  → uploadAttachment(draftId, file, onProgress, signal)
       → GET /api/socket   ← fetch JWT for XHR auth
       → XHR POST /api/v1/outbound/drafts/:draftId/attachments
           (multipart/form-data, field: 'file')
       → progress callback → live progress bar in AttachmentPreview
       → on success: upload.result = { attachmentId, cdnUrl, kind, fileName, fileSize }
```

**Hook:** `frontend/hooks/useUpload.ts` — `useUpload(draftId)` returns `{ uploads, addFiles, removeFile, retryFile, clearAll, isUploading, hasAttachments }`

**Upload lib:** `frontend/lib/upload.ts` — uses XHR (not fetch) because `fetch` does not support upload progress events. Token fetched from `/api/socket` route.

**Size limits:**
- Images: 20 MB
- Video: 100 MB
- Audio / Documents: 50 MB

## WebSocket Events

### Emitted (client → server)
| Event          | Component      | When                         | Payload     |
|----------------|----------------|------------------------------|-------------|
| `chat:join`    | `ChatView`     | Contact selected (mount)     | `{ contactId }` |
| `chat:leave`   | `ChatView`     | Contact deselected (unmount) | `{ contactId }` |
| `enquiry:join` | `ChatView`     | After thread loaded          | `{ enquiryId }` |
| `typing:start` | `ChatView` (InlineComposer) | User starts typing | `{ enquiryId }` |
| `typing:stop`  | `ChatView` (InlineComposer) | 2s after last keystroke | `{ enquiryId }` |

### Subscribed (server → client)
| Event                     | Handler              | Effect               |
|------------|--------------|----------------------|-----------------------
| `notification:new-message`  | `messaging/page.tsx` | Show `<MessageToast>`, increment unread badge for that contactId |
| `contact-list:update`       | `ContactList`        | Replace contact list (only if no active search)                  |
| `chat:new-message`          | `ChatView`           | Append inbound message to thread                                 |
| `outbound:sent`             | `ChatView`           | Append outbound message to thread                                |
| `outbound:delivery_updated` | `ChatView`           | Update delivery status badge on message                          |
| `message:reaction_updated`  | `ChatView`           | Re-render reaction row on message                                |
| `message:deleted`           | `ChatView`           | Mark message as deleted in thread                                |
| `message:edited`            | `ChatView`           | Update message content + show edited timestamp                   |
| `typing:update`             | `ChatView` (InlineComposer) | Show/hide typing indicator with user name                        |

## State Management
All state is local React state in `messaging/page.tsx` and `ChatView.tsx`:
- `activeContactId` — which contact is selected
- `unreadContacts: Record<string, number>` — badge counts per contactId
- Draft body, channel, draftId — in `InlineComposer` (inside `ChatView`)
- Upload queue — managed by `useUpload` hook

No Zustand usage beyond the auth store for permissions.

## Auth & Permissions
- Protected by `DashboardLayout`
- CASL required: `read:enquiry` (sidebar nav item uses this)
- Draft operations require: `create:outbounddraft`, `update:outbounddraft`
- Send requires: `create:conversationmessage`
