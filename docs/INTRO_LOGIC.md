# Intro Request Logic

Internal documentation for the intro request lifecycle — statuses, transitions, permissions, and how requests are displayed in the UI.

---

## Roles

Every intro request involves up to four roles:

| Role           | Who                                                                 |
|----------------|---------------------------------------------------------------------|
| **Requester**  | The user who creates the intro request                              |
| **Connector**  | A space member or 1:1 connection peer who has contacts at the target company |
| **Space Owner** | The owner of the space (only relevant for `admin_review` spaces)   |
| **Target Contact** | The external person the requester wants to be introduced to     |

---

## Request Statuses

An intro request has a primary `status` field and an optional `adminStatus` field (only used in `admin_review` spaces).

### Primary Status (`status`)

| Status      | Meaning                                      |
|-------------|----------------------------------------------|
| `open`      | Active request, waiting for a connector to act |
| `accepted`  | A connector marked the intro as done         |
| `declined`  | A connector declined the request             |
| `completed` | Requester manually marked as completed       |

### Admin Status (`adminStatus`)

Only applies to requests in spaces with `introReviewMode = 'admin_review'`. Null for all other requests.

| Admin Status     | Meaning                                                         |
|------------------|-----------------------------------------------------------------|
| `null`           | Not applicable (space uses `end_to_end` mode, or 1:1 request)  |
| `pending_review` | Request created, waiting for space owner to approve or reject   |
| `approved`       | Space owner approved — connectors are now notified              |
| `rejected`       | Space owner rejected — request is also set to `declined`        |

---

## Status Transitions

### Who can change what

| Transition                        | Who can do it    | How                                   |
|-----------------------------------|------------------|---------------------------------------|
| → `open`                          | Requester        | Creating a new request                |
| `open` → `accepted`              | Connector        | "Mark as done" action (`PATCH /:id/done`) |
| `open` → `declined`              | Connector        | "Decline" action (`PATCH /:id/decline`) |
| `open` → `completed`             | Requester        | Manually close own request (`PATCH /:id/status`) |
| `accepted` → `completed`         | Requester        | Manually close after intro was made   |
| `pending_review` → `approved`    | Space Owner      | Admin approves (`PATCH /:id/admin-review`) |
| `pending_review` → `rejected`    | Space Owner      | Admin rejects (also sets `status` to `declined`) |

### Valid transitions enforced by the backend

```
open ──────→ accepted
open ──────→ declined (by connector or admin rejection)
open ──────→ completed (by requester)
accepted ──→ completed (by requester)
completed ──→ (terminal)
declined ───→ (terminal)
```

### Constraints

- A connector **cannot** decline or mark done their own request
- A connector **cannot** act on a request that is not `open`
- A connector **cannot** act on a request with `adminStatus = 'pending_review'`
- Only the **requester** can delete a request
- Only the **requester** can transition `open → completed` or `accepted → completed`
- Only the **space owner** can approve/reject `pending_review` requests

---

## In-Progress Flags

While a request remains `open`, connectors can take intermediate actions that don't change the status but mark the request as "in progress":

| Flag                    | Set by    | Trigger                              | Meaning                                |
|-------------------------|-----------|--------------------------------------|----------------------------------------|
| `detailsRequestedAt`   | Connector | "Ask for details" email sent         | Connector emailed requester for context |
| `checkedWithContactAt` | Connector | "Ask permission" email sent          | Connector emailed the target contact for consent |
| `checkedWithContacts`  | Connector | "Ask permission" (accumulates)       | Array of all contacts checked with     |

These flags affect how the request appears in the UI (see below) but do not change `status`.

---

## Space Review Modes

Each space has an `introReviewMode` setting:

| Mode           | Behavior                                                                          |
|----------------|-----------------------------------------------------------------------------------|
| `end_to_end`   | Default. Requests go directly to connectors — no admin gate.                      |
| `admin_review` | Requests first go to the space owner for approval. Connectors are only notified after approval. |

### Admin Review Flow

```
Member creates request
     │
     ├── Owner created it? → adminStatus = 'approved' (auto-approved), connectors notified immediately
     │
     └── Non-owner created it? → adminStatus = 'pending_review'
              │
              ├── Owner clicks "Approve" → adminStatus = 'approved', connectors notified
              │
              └── Owner clicks "Reject" → adminStatus = 'rejected', status = 'declined'
```

When a space switches from `admin_review` to `end_to_end`, all `pending_review` requests are auto-approved and connectors are notified retroactively.

---

## Who Creates the Request

| Context            | Who can create                                  | Where it's stored               |
|--------------------|------------------------------------------------|----------------------------------|
| Space request      | Any approved space member                       | `IntroRequest.spaceId` set       |
| 1:1 connection     | Either party in an accepted connection          | `normalizedQuery.connectionPeerId` set |

---

## Notifications

| Event                          | Who gets notified          | Notification type      |
|--------------------------------|---------------------------|------------------------|
| Request created (end_to_end)   | Connectors with contacts at target company | `intro_request` |
| Request created (admin_review) | Space owner only          | `intro_review`         |
| Admin approves request         | Requester + connectors    | `intro_approved` + `intro_request` |
| Admin rejects request          | Requester                 | `intro_declined`       |
| Connector declines             | Requester                 | `intro_declined`       |
| Connector marks done           | Requester                 | `intro_offered`        |
| Connector asks for details     | Requester                 | `details_requested`    |
| 1:1 request created            | Connection peer           | `intro_request`        |

---

## UI Categories

The Intros tab splits requests into two sections — **received** (from others) and **sent** (your own). Each section groups requests into sub-categories based on status and flags.

### Received Requests ("Intro requests from others")

Requests where the current user is a potential connector.

| Sub-group           | Filter logic                                                                 | Status badge               |
|----------------------|-----------------------------------------------------------------------------|----------------------------|
| **Needs your review** | `status = 'open'` AND no `detailsRequestedAt` AND no `checkedWithContactAt` AND user has contacts at target company | "Needs your review"     |
| **In progress**      | `status = 'open'` AND (`detailsRequestedAt` OR `checkedWithContactAt` OR user has no contacts at target company) | "Waiting for details" / "Checking with contact" |
| **Past**             | `status ≠ 'open'` (declined or accepted)                                   | "Done" / "Declined"       |

### Sent Requests ("Your intro requests")

Requests created by the current user.

| Sub-group              | Filter logic                                                              | Status badge               |
|------------------------|--------------------------------------------------------------------------|----------------------------|
| **Awaiting admin review** | `status = 'open'` AND `adminStatus = 'pending_review'`               | "Awaiting admin review"   |
| **Needs your review**  | `status = 'open'` AND `adminStatus ≠ 'pending_review'` AND `detailsRequestedAt` is set | "Awaiting your reply" |
| **In progress**        | `status = 'open'` AND `adminStatus ≠ 'pending_review'` AND no `detailsRequestedAt` | "In progress"         |
| **Past**               | `status ≠ 'open'`                                                       | "Done" / "Declined" / "Not approved" |

### Space Detail Panel

Within a specific space, requests are shown with additional admin context:

| Sub-group              | Who sees it   | Filter logic                                                       | Status badge                    |
|------------------------|---------------|--------------------------------------------------------------------|---------------------------------|
| **Pending admin review** | Owner only   | `status = 'open'` AND `adminStatus = 'pending_review'`            | "Pending review"               |
| **Needs your review**  | All members   | `status = 'open'` AND `adminStatus ≠ 'pending_review'` AND user has contacts at target | "Needs your review" |
| **In progress**        | All members   | `status = 'open'` AND (no contacts at target OR details/check flags set OR `adminStatus = 'approved'`) | "Approved — with connectors" / "Waiting for details" / "Checking with contact" |
| **Past**               | All members   | `status ≠ 'open'`                                                  | "Done" / "Declined" / "Not approved" |

---

## Who Sees Which Requests

### In Spaces

| Role         | What they see                                                                   |
|--------------|---------------------------------------------------------------------------------|
| **Owner**    | All requests in the space (including `pending_review` for admin action)         |
| **Requester** | Their own requests                                                             |
| **Member**   | Requests where they were notified (they have contacts at the target company) or they made an offer |

### In 1:1 Connections

| Role         | What they see                                |
|--------------|----------------------------------------------|
| Both parties | All requests sent between them               |

### Privacy Rules

| Data                     | Visible?                                                                                    |
|--------------------------|---------------------------------------------------------------------------------------------|
| Who declined (in Space)  | Hidden — requester only sees "Declined" without knowing who                                 |
| Who declined (in 1:1)    | Visible — the peer's name is shown                                                          |
| Who asked for details    | Always visible — the connector's name is shown to the requester                             |
| Who checked with contact | Always visible — shown in the request timeline                                               |

---

## Connector Actions

When a connector views a received request that is `open` and not `pending_review`, they can take these actions:

| Action                | What happens                                                                  | Changes status? | Changes flags?            |
|-----------------------|-------------------------------------------------------------------------------|-----------------|---------------------------|
| **Ask for details**   | Sends email to requester asking for more context                              | No              | Sets `detailsRequestedAt` |
| **Ask permission**    | Sends email to target contact asking if they're open to an intro              | No              | Sets `checkedWithContactAt`, appends to `checkedWithContacts` |
| **Make intro**        | Sends 3-way double-intro email connecting requester and target contact        | Yes → `accepted` | Creates `IntroOffer`     |
| **Mark as done**      | Marks the intro as completed without sending an email through the platform    | Yes → `accepted` | Creates `IntroOffer`     |
| **Decline**           | Declines the request with an optional reason                                  | Yes → `declined` | Sets `declinedById`, `declineReason` |

---

## Complete Lifecycle Diagram

```
Requester creates request
         │
         ├── Space (end_to_end mode)
         │     │
         │     └── Connectors notified immediately
         │           │
         │           ├── Ask for details → email to requester (status stays open)
         │           ├── Ask permission → email to contact (status stays open)
         │           ├── Make intro / Done → status = accepted
         │           └── Decline → status = declined
         │
         ├── Space (admin_review mode)
         │     │
         │     ├── Owner created? → auto-approved, connectors notified
         │     │
         │     └── Member created? → pending_review
         │           │
         │           ├── Owner approves → connectors notified → same flow as above
         │           └── Owner rejects → status = declined
         │
         └── 1:1 Connection
               │
               └── Peer notified directly → same connector actions as above
```

---

## Database Fields Reference

### IntroRequest

| Field                    | Type       | Purpose                                                |
|--------------------------|------------|--------------------------------------------------------|
| `status`                 | String     | Primary status: `open`, `accepted`, `declined`, `completed` |
| `adminStatus`            | String?    | Admin review: `pending_review`, `approved`, `rejected` |
| `declineReason`          | String?    | Reason provided when declining                         |
| `declinedById`           | String?    | User ID of the person who declined                     |
| `detailsRequestedAt`     | DateTime?  | When "ask for details" was triggered                   |
| `detailsRequestedById`   | String?    | Who asked for details                                  |
| `checkedWithContactAt`   | DateTime?  | When "ask permission" was last triggered               |
| `checkedWithContactName` | String?    | Name of the last contact checked with                  |
| `checkedWithContactById` | String?    | Who last checked with the contact                      |
| `checkedWithContacts`    | Json?      | Array of all check-with-contact events: `[{at, name, byId}]` |
| `adminReviewedById`      | String?    | Space owner who reviewed                               |
| `adminReviewedAt`        | DateTime?  | When admin review happened                             |
| `adminRejectReason`      | String?    | Reason for admin rejection                             |

### IntroOffer

| Field          | Type   | Purpose                                                |
|----------------|--------|--------------------------------------------------------|
| `status`       | String | `pending`, `accepted`, `rejected`                      |
| `introducerId` | String | The connector who made the offer                       |
| `message`      | String | Description of the intro                               |
