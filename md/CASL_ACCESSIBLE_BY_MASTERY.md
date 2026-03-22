# accessibleBy() Mastery — From Zero to Complete Understanding

> **Goal of this file:** After reading this, you will never feel like you are copy-pasting random syntax. You will understand WHY every character exists, HOW Prisma queries are built from CASL rules, and WHEN to use what. No more guessing.

---

## Table of Contents

1. [The Fundamental Question: Why Not Just `WHERE assignedToId = userId`?](#1-the-fundamental-question)
2. [What Problem Does CASL Solve That Raw Queries Don't?](#2-what-problem-does-casl-solve)
3. [How Permissions Are Stored in Your Database](#3-how-permissions-are-stored)
4. [How `createForUser()` Builds the Ability Object](#4-how-createforuser-builds-ability)
5. [What the Ability Object Actually Contains](#5-what-ability-object-contains)
6. [What `accessibleBy()` Is — The Simple Truth](#6-what-accessibleby-is)
7. [The Dot Syntax: `.Enquiry`, `.Message`, `.Contact`](#7-the-dot-syntax)
8. [How CASL Reads Rules and Builds Prisma WHERE](#8-how-casl-builds-prisma-where)
9. [AND / OR Logic — How Multiple Rules Combine](#9-and-or-logic)
10. [Real Examples From Your Project With Query Output](#10-real-examples)
11. [What Happens When Rules Have `cannot()`](#11-cannot-rules)
12. [Pattern: Combining `accessibleBy` With Your Own Filters](#12-combining-with-own-filters)
13. [Pattern: Single Record Access Check](#13-single-record-check)
14. [Subject Naming: Why `'enquiry'` vs `.Enquiry`](#14-subject-naming)
15. [The Complete Internal Flow — Step by Step With Diagrams](#15-complete-internal-flow)
16. [Common Mistakes and How to Avoid Them](#16-common-mistakes)
17. [Quick Reference Cheat Sheet](#17-cheat-sheet)

---

## 1. The Fundamental Question

### "Why can't I just write `WHERE assignedToId = userId`?"

You absolutely CAN. And honestly, for a single hardcoded case, it would be simpler.

```ts
// ✅ This works perfectly fine
const enquiries = await prisma.enquiry.findMany({
  where: { assignedToId: userId },
});
```

So why bother with CASL? Because of this:

### The real world has MANY roles, and each sees data differently

Look at your project's roles:

| Role | What they can see | Condition |
|------|------------------|-----------|
| **ADMIN** | Everything | No condition at all |
| **MANAGER** | All enquiries | No condition |
| **SALES** | All enquiries for reading, but can only UPDATE the ones assigned to them | `assignedToId = userId` on update |
| **OPS** | Read-only, all enquiries | No condition |

Now imagine writing raw queries:

```ts
// ❌ Hardcoded approach — every service method needs role checks
async findAll(userId: string, role: string) {
  let where: any = {};
  
  if (role === 'SALES') {
    where.assignedToId = userId;
  }
  // ADMIN, MANAGER — no filter
  // OPS — read-only, checked at route level
  
  return prisma.enquiry.findMany({ where });
}
```

This has THREE problems:

### Problem 1: Role logic is scattered everywhere

If you have 15 service methods across 8 modules, you are writing `if (role === 'SALES')` in 15 different places.

When business rules change (e.g., "SALES should now also see enquiries in their department"), you must find and update ALL 15 places.

### Problem 2: Permissions are hardcoded in TypeScript

If the admin wants to change what SALES can do, you must:
1. Change code
2. Redeploy the server
3. Hope you didn't break anything

With CASL + database permissions, the admin changes a row in the database. Done.

### Problem 3: Complex conditions become unmaintainable

What if SALES can:
- Read all enquiries
- Update only assigned ones
- Delete only assigned ones that are also CLOSED_LOST

Now try writing that with `if/else`:

```ts
// ❌ This gets ugly FAST
if (role === 'SALES') {
  if (action === 'read') {
    where = {};  // no filter
  } else if (action === 'update') {
    where.assignedToId = userId;
  } else if (action === 'delete') {
    where.assignedToId = userId;
    where.status = 'CLOSED_LOST';
  }
}
```

Now multiply this by every role × every action × every subject.

### The CASL answer

With CASL, all those rules live in ONE place (database), are built ONCE per request (ability object), and are applied AUTOMATICALLY as Prisma where clauses:

```ts
// ✅ CASL approach — ONE line, works for every role
const enquiries = await prisma.enquiry.findMany({
  where: accessibleBy(ability).Enquiry,
});
```

This ONE line:
- For ADMIN → generates `{}` (no filter, see everything)
- For SALES → generates `{ assignedToId: 'user-123' }`
- For OPS → generates `{}` (read is unconditional)
- For any future role → generates whatever the database says

**That is WHY.**

---

## 2. What Problem Does CASL Solve That Raw Queries Don't?

Think of it like this:

| Approach | Where rules live | Who changes them | How many places to update |
|----------|-----------------|------------------|--------------------------|
| Raw `if/else` | In code files | Developer (redeploy) | Every service method |
| CASL + DB | In database rows | Admin (no redeploy) | Zero service methods |

CASL is a **permissions engine**. It takes rules and produces two things:

1. **Boolean answers**: `ability.can('read', 'enquiry')` → `true` or `false`
2. **Database filters**: `accessibleBy(ability).Enquiry` → Prisma `where` clause

The boolean answers are used by guards (route-level).
The database filters are used by services (data-level).

---

## 3. How Permissions Are Stored in Your Database

Your project has two tables for permissions:

### Table 1: `Permission`

This table stores WHAT actions exist on WHAT subjects:

```
┌────────────────────────────────────────────┐
│              Permission Table               │
├──────┬──────────┬───────────┬──────────────┤
│  id  │  action  │  subject  │              │
├──────┼──────────┼───────────┤              │
│ p1   │  read    │  enquiry  │              │
│ p2   │  create  │  enquiry  │              │
│ p3   │  update  │  enquiry  │              │
│ p4   │  delete  │  enquiry  │              │
│ p5   │  assign  │  enquiry  │              │
│ p6   │  manage  │  all      │  ← superpower│
│ p7   │  read    │  message  │              │
│ p8   │  create  │  message  │              │
│ ...  │  ...     │  ...      │              │
└──────┴──────────┴───────────┴──────────────┘
```

Think of this as a **menu of all possible permissions**. It just lists everything that CAN exist.

### Table 2: `RolePermission`

This table says WHICH role gets WHICH permission, and with WHAT conditions:

```
┌────────────────────────────────────────────────────────────────────┐
│                      RolePermission Table                          │
├──────┬─────────┬──────────────┬─────────────────────────────────────┤
│  id  │  role   │ permissionId │        conditions (JSON)            │
├──────┼─────────┼──────────────┼─────────────────────────────────────┤
│ rp1  │ ADMIN   │ p6 (manage:all)│  null                            │
│ rp2  │ SALES   │ p1 (read:enquiry)│  null  ← no condition         │
│ rp3  │ SALES   │ p3 (update:enquiry)│  { "assignedToId": "$userId" }│
│ rp4  │ MANAGER │ p1 (read:enquiry)│  null                         │
│ rp5  │ MANAGER │ p3 (update:enquiry)│  null  ← no condition!      │
│ ...  │ ...     │ ...            │ ...                              │
└──────┴─────────┴──────────────┴─────────────────────────────────────┘
```

**Key insight**: The `conditions` column is where the magic is.

- `null` means "no restriction, full access for this action"
- `{ "assignedToId": "$userId" }` means "only when the row's `assignedToId` matches the logged-in user"
- `$userId` is a **placeholder** — not a real value yet

---

## 4. How `createForUser()` Builds the Ability Object

When a request comes in, the CASL guard calls:

```ts
const ability = await this.caslAbilityFactory.createForUser(user);
```

Here is exactly what happens inside, line by line:

### Step 1: Create the builder

```ts
const { can, cannot, build } = new AbilityBuilder<AppAbility>(
  createPrismaAbility as any,
);
```

**What this gives you:**
- `can(...)` — a function to ADD an "allow" rule
- `cannot(...)` — a function to ADD a "deny" rule
- `build()` — a function to FINALIZE and return the ability object

Think of `AbilityBuilder` like a **blank permissions sheet**. You use `can()` to write on it.

The `createPrismaAbility` part is crucial — it tells CASL: "The conditions I'm about to add are in **Prisma format**, not plain JavaScript format." This is what enables `accessibleBy()` to generate valid Prisma `where` clauses later.

### Step 2: Load permissions from database

```ts
const rolePermissions = await this.prisma.rolePermission.findMany({
  where: { role: user.role },
  include: { permission: true },
});
```

If the user is SALES, this returns:

```ts
[
  { permission: { action: 'read',   subject: 'enquiry' }, conditions: null },
  { permission: { action: 'create', subject: 'enquiry' }, conditions: null },
  { permission: { action: 'update', subject: 'enquiry' }, conditions: { assignedToId: '$userId' } },
  { permission: { action: 'read',   subject: 'message' }, conditions: null },
  { permission: { action: 'create', subject: 'message' }, conditions: null },
  { permission: { action: 'read',   subject: 'dashboard' }, conditions: null },
]
```

### Step 3: Loop and add rules

```ts
for (const rp of rolePermissions) {
  const action = rp.permission.action.toLowerCase() as Actions;
  const subject = rp.permission.subject.toLowerCase() as AppSubjects;

  let conditions = rp.conditions as any;
  if (conditions) {
    conditions = this.resolvePlaceholders(conditions, user);
  }

  if (action === 'manage' && subject === 'all') {
    can('manage', 'all');  // superadmin — can do EVERYTHING
  } else {
    can(action, subject, conditions || undefined);
  }
}
```

For SALES user with `userId = 'u1'`, this loop does:

```ts
// Iteration 1: read:enquiry — no condition
can('read', 'enquiry');

// Iteration 2: create:enquiry — no condition
can('create', 'enquiry');

// Iteration 3: update:enquiry — HAS condition
// Before: { assignedToId: '$userId' }
// resolvePlaceholders replaces $userId with 'u1'
// After:  { assignedToId: 'u1' }
can('update', 'enquiry', { assignedToId: 'u1' });

// Iteration 4: read:message — no condition
can('read', 'message');

// ... and so on
```

### Step 4: Build and return

```ts
return build();
```

This freezes all the rules and returns the final `ability` object.

### What `resolvePlaceholders` does

```ts
private resolvePlaceholders(conditions: any, user: AuthUser) {
  const resolved = { ...conditions };
  for (const key of Object.keys(resolved)) {
    if (resolved[key] === '$userId') {
      resolved[key] = user.userId;
    }
  }
  return resolved;
}
```

This is simple string replacement:
- Input: `{ assignedToId: '$userId' }` + user `{ userId: 'u1' }`
- Output: `{ assignedToId: 'u1' }`

Why use placeholders? Because in the database, the condition `{ "assignedToId": "$userId" }` is the **same row** for ALL sales users. You don't need a separate database row for each sales person. The template is shared; the actual value is filled at runtime.

---

## 5. What the Ability Object Actually Contains

After `build()`, the ability object is essentially a **list of rules** inside it.

For SALES user `u1`, it looks like this internally (simplified):

```ts
ability.rules = [
  { action: 'read',   subject: 'enquiry',   conditions: undefined },
  { action: 'create', subject: 'enquiry',   conditions: undefined },
  { action: 'update', subject: 'enquiry',   conditions: { assignedToId: 'u1' } },
  { action: 'read',   subject: 'message',   conditions: undefined },
  { action: 'create', subject: 'message',   conditions: undefined },
  { action: 'read',   subject: 'dashboard', conditions: undefined },
];
```

This is just data. An array of objects. Nothing magical.

The ability object gives you two powers:

### Power 1: Ask yes/no questions

```ts
ability.can('read', 'enquiry')    // → true  (rule exists, no condition)
ability.can('update', 'enquiry')  // → true  (rule exists, has condition but we're asking generally)
ability.can('delete', 'enquiry')  // → false (no such rule)
ability.can('read', 'message')    // → true
ability.can('manage', 'all')      // → false (not ADMIN)
```

### Power 2: Generate database filters (via `accessibleBy`)

This is where it gets interesting. Let's understand it fully.

---

## 6. What `accessibleBy()` Is — The Simple Truth

```ts
import { accessibleBy } from '@casl/prisma';
```

`accessibleBy` is a **function that takes an ability object** and returns a **Proxy object** with properties named after your Prisma models.

When you write:

```ts
accessibleBy(ability)
```

You get back an object that has `.Enquiry`, `.Message`, `.Contact`, `.User`, etc. — one property for each Prisma model.

When you access one of those properties, CASL:
1. Looks at all rules in the ability that match that subject
2. Extracts the conditions from those rules
3. Combines them using `OR` logic
4. Returns a valid Prisma `where` clause

That's ALL it does. It's a **rule-to-query translator**.

---

## 7. The Dot Syntax: `.Enquiry`, `.Message`, `.Contact`

This is where most people get confused. Let me break it down completely.

### What `accessibleBy(ability).Enquiry` literally means

```ts
const whereClause = accessibleBy(ability).Enquiry;
```

Reading this in English: **"Give me the Prisma WHERE filter for all Enquiry records this ability allows access to."**

### How does `.Enquiry` know which rules to look at?

The dot-property name **matches with the `subject` in your CASL rules**, but with a mapping.

In your rules, subjects are lowercase:
```ts
can('read', 'enquiry', { assignedToId: 'u1' });
//                ^ lowercase
```

But Prisma model names are PascalCase:
```ts
prisma.enquiry.findMany(...)
//     ^ lowercase in Prisma client, but model NAME is Enquiry
```

The `@casl/prisma` library handles this mapping internally. When you access `.Enquiry`, it searches for rules where `subject === 'enquiry'` (case-insensitive matching).

### So when you write:

```ts
accessibleBy(ability).Enquiry
```

It does this:

```
Step 1: "I need rules for subject 'enquiry'"
Step 2: Filter ability.rules → find all rules where subject matches 'enquiry'
Step 3: For each matching rule, extract the condition
Step 4: Combine all conditions with OR
Step 5: Return as Prisma-compatible WHERE object
```

### What about other models?

```ts
accessibleBy(ability).Message    // → rules for subject 'message'
accessibleBy(ability).Contact    // → rules for subject 'contact'
accessibleBy(ability).User       // → rules for subject 'user'
```

Each dot-property looks at a different set of rules.

### Why PascalCase and not lowercase?

Because Prisma models in your `schema.prisma` are defined as:

```prisma
model Enquiry { ... }
model ConversationMessage { ... }
model Contact { ... }
```

The `@casl/prisma` library uses these model names. This keeps things consistent with how Prisma itself works.

---

## 8. How CASL Reads Rules and Builds Prisma WHERE

This is the core of everything. Let me walk through it step by step with real data.

### Scenario: SALES user `u1` calls `findAll()`

The ability has these rules:

```ts
[
  { action: 'read',   subject: 'enquiry', conditions: undefined },
  { action: 'create', subject: 'enquiry', conditions: undefined },
  { action: 'update', subject: 'enquiry', conditions: { assignedToId: 'u1' } },
]
```

Now your service does:

```ts
accessibleBy(ability).Enquiry
```

### What CASL does internally:

**Step 1: Find matching rules**

`accessibleBy(ability)` internally calls a function that by default looks for rules where the action is `'read'` (that is the default when you just use `accessibleBy(ability)` without specifying action, but more on this shortly).

Wait — actually, `accessibleBy(ability)` with no action argument considers **ALL** `can` rules for the subject. Let me be precise:

When you write:

```ts
accessibleBy(ability).Enquiry
```

CASL looks at **all rules** where `subject === 'enquiry'` and the rule type is `can` (not `cannot`).

Matching rules:
```ts
[
  { action: 'read',   subject: 'enquiry', conditions: undefined },     // ← matches
  { action: 'create', subject: 'enquiry', conditions: undefined },     // ← matches
  { action: 'update', subject: 'enquiry', conditions: { assignedToId: 'u1' } }, // ← matches
]
```

**Step 2: Extract conditions**

- Rule 1 (`read:enquiry`): `conditions = undefined` → means **NO restriction** → everything is accessible
- Rule 2 (`create:enquiry`): `conditions = undefined` → no restriction
- Rule 3 (`update:enquiry`): `conditions = { assignedToId: 'u1' }` → only matching rows

**Step 3: Handle the "no condition = everything" case**

When ANY rule has `conditions: undefined`, it means "access to ALL records" for that action.

Because the rules are combined with `OR`, and one of them has no condition (rule 1: read all enquiries), the result is: **ALL enquiries are accessible**.

Why? Because:
```
(no condition = ALL rows)  OR  (assignedToId = 'u1')  =  ALL rows
```

If everything is already allowed by the first rule, adding more restrictions via OR makes no difference.

**Step 4: Generate Prisma WHERE**

Result:
```ts
{} // empty where = no filter = return ALL enquiries
```

### But wait — what if we want to filter by action?

You can specify the action:

```ts
accessibleBy(ability, 'update').Enquiry
```

Now CASL only looks at rules where `action === 'update'` AND `subject === 'enquiry'`.

Matching rules:
```ts
[
  { action: 'update', subject: 'enquiry', conditions: { assignedToId: 'u1' } },
]
```

Only one rule. Its condition is `{ assignedToId: 'u1' }`.

Result:
```ts
{ assignedToId: 'u1' }
```

**This is a massive distinction!**

| Expression | What it means | Result for SALES `u1` |
|-----------|---------------|----------------------|
| `accessibleBy(ability).Enquiry` | All enquiry rules (any action) | `{}` (because `read` has no condition) |
| `accessibleBy(ability, 'read').Enquiry` | Only `read:enquiry` rules | `{}` (no condition on read) |
| `accessibleBy(ability, 'update').Enquiry` | Only `update:enquiry` rules | `{ assignedToId: 'u1' }` |
| `accessibleBy(ability, 'delete').Enquiry` | Only `delete:enquiry` rules | **THROWS ERROR** (no rule exists) |

When no matching rule exists at all, `accessibleBy` throws an error. That's why your code has a `try/catch`:

```ts
try {
  where.AND = [accessibleBy(ability).Enquiry];
} catch {
  return { items: [], meta: { page, limit, total: 0, totalPages: 0 } };
}
```

---

## 9. AND / OR Logic — How Multiple Rules Combine

This is critical. Let me make it crystal clear.

### Multiple `can` rules for the same subject → combined with `OR`

Imagine a role has:

```ts
can('read', 'enquiry', { assignedToId: 'u1' });
can('read', 'enquiry', { status: 'NEW' });
```

Two rules both say "allow read on enquiry" but with different conditions.

CASL combines them with **OR**:

```ts
// Generated Prisma WHERE:
{
  OR: [
    { assignedToId: 'u1' },
    { status: 'NEW' },
  ]
}
```

In English: "Show me enquiries that are assigned to me **OR** have status NEW."

This makes sense: each `can()` rule is an **additional grant of access**. More `can` rules = more access.

### Why OR and not AND?

Think of it logically:

- Rule 1 says: "You can read enquiries assigned to you"
- Rule 2 says: "You can read enquiries with status NEW"

The user should see **both** — enquiries assigned to them AND enquiries that are new. That's OR.

If it were AND, the user would ONLY see enquiries that are assigned to them AND are new. That's too restrictive — it would ignore rule 1 for non-new enquiries and rule 2 for non-assigned enquiries.

### When one rule has NO condition → result is everything

```ts
can('read', 'enquiry');  // no condition → all enquiries
can('read', 'enquiry', { status: 'NEW' });
```

```ts
// Generated Prisma WHERE:
// Since one rule has no condition (= all), the OR includes "everything"
// "everything OR (status = NEW)" = everything
{}
```

### Visual diagram of OR combining

```
Rule A: can('read', 'enquiry', { assignedToId: 'u1' })
Rule B: can('read', 'enquiry', { status: 'NEW' })
Rule C: can('read', 'enquiry', { type: 'REAL', priority: { gte: 5 } })

                    ┌─────────────────────┐
                    │     accessibleBy     │
                    │   (ability, 'read')  │
                    │      .Enquiry        │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │         OR          │
                    │                     │
           ┌───────┼───────┐    ┌────────┼────────┐
           │       │       │    │        │        │
      Rule A   Rule B   Rule C
           │       │       │
  { assigned   { status  { type: 'REAL',
    ToId:       : 'NEW'   priority:
    'u1' }     }          { gte: 5 } }
```

Final Prisma WHERE:

```ts
{
  OR: [
    { assignedToId: 'u1' },
    { status: 'NEW' },
    { AND: [{ type: 'REAL' }, { priority: { gte: 5 } }] },
  ]
}
```

Wait — why `AND` inside one of the `OR` branches?

### Conditions with multiple keys → combined with AND `inside` that one rule

When a single rule has multiple condition keys:

```ts
can('read', 'enquiry', { type: 'REAL', priority: { gte: 5 } });
```

This single object `{ type: 'REAL', priority: { gte: 5 } }` means BOTH must match. Prisma treats a single object's keys as AND by default.

So:
- **Multiple keys in ONE rule** → AND (both must be true)
- **Multiple rules for same action+subject** → OR (any rule can grant access)

### Summary of combining logic

```
WITHIN one rule:    { keyA: valueA, keyB: valueB }  →  keyA AND keyB
ACROSS rules:       rule1 OR rule2 OR rule3
```

---

## 10. Real Examples From Your Project With Query Output

Let me trace through real scenarios using YOUR actual seed data.

### Example 1: ADMIN calls `findAll()`

Ability rules (from `manage:all`):

```ts
can('manage', 'all');
// This is a superpower — means "can do ANY action on ANY subject"
```

```ts
accessibleBy(ability).Enquiry
```

CASL sees `manage:all` — this matches EVERY subject, EVERY action, with NO condition.

**Generated Prisma WHERE:**
```ts
{}  // no filter — ADMIN sees everything
```

**Actual SQL sent to database:**
```sql
SELECT * FROM "Enquiry"
-- No WHERE clause at all. Full table scan.
```

### Example 2: SALES user `u1` calls `findAll()` for reading

Ability rules:

```ts
can('read', 'enquiry');  // no condition
can('update', 'enquiry', { assignedToId: 'u1' });
```

```ts
accessibleBy(ability).Enquiry  // default: considers all actions
```

Since `read:enquiry` has NO condition → it grants access to ALL enquiries.

**Generated Prisma WHERE:**
```ts
{}  // SALES can READ all enquiries
```

**Actual SQL:**
```sql
SELECT * FROM "Enquiry"
-- No restriction — they can READ all
```

### Example 3: SALES user `u1` — filter specifically for UPDATE access

```ts
accessibleBy(ability, 'update').Enquiry
```

Only looks at `update:enquiry` rules:
```ts
can('update', 'enquiry', { assignedToId: 'u1' });
```

**Generated Prisma WHERE:**
```ts
{ assignedToId: 'u1' }
```

**Actual SQL:**
```sql
SELECT * FROM "Enquiry" WHERE "assignedToId" = 'u1'
```

Only enquiries assigned to user `u1` can be updated.

### Example 4: OPS user calls `findAll()`

Ability rules:

```ts
can('read', 'enquiry');   // no condition
// OPS has NO update, create, delete, or assign permission for enquiry
```

```ts
accessibleBy(ability).Enquiry
```

**Generated Prisma WHERE:**
```ts
{}  // OPS can read all enquiries
```

### Example 5: Hypothetical — SALES with department-based access

Imagine this future rule:

```ts
can('read', 'enquiry', { departmentId: 'dept-sales' });
can('read', 'enquiry', { assignedToId: 'u1' });
```

```ts
accessibleBy(ability, 'read').Enquiry
```

**Generated Prisma WHERE:**
```ts
{
  OR: [
    { departmentId: 'dept-sales' },
    { assignedToId: 'u1' },
  ]
}
```

**Actual SQL:**
```sql
SELECT * FROM "Enquiry"
WHERE "departmentId" = 'dept-sales' OR "assignedToId" = 'u1'
```

Beautiful. One line of code, complex query. No if/else anywhere.

### Example 6: Hypothetical — Nested conditions

```ts
can('read', 'enquiry', {
  OR: [
    { assignedToId: 'u1' },
    { status: 'NEW' },
  ]
});
```

Yes, you CAN put Prisma-style operators inside conditions because you used `createPrismaAbility`.

**Generated Prisma WHERE:**
```ts
{
  OR: [
    { assignedToId: 'u1' },
    { status: 'NEW' },
  ]
}
```

---

## 11. What Happens When Rules Have `cannot()`

CASL supports deny rules too. `cannot()` is the opposite of `can()`.

```ts
can('read', 'enquiry');  // allow read all
cannot('read', 'enquiry', { status: 'CLOSED_LOST' });  // deny read closed-lost
```

In English: "Can read all enquiries EXCEPT those with status CLOSED_LOST."

**Generated Prisma WHERE:**
```ts
{
  AND: [
    {},  // from can('read', 'enquiry') — no filter = all
    { NOT: { status: 'CLOSED_LOST' } },  // from cannot()
  ]
}
```

**Simplified by Prisma:**
```ts
{ NOT: { status: 'CLOSED_LOST' } }
```

**Actual SQL:**
```sql
SELECT * FROM "Enquiry" WHERE NOT ("status" = 'CLOSED_LOST')
```

### How `cannot` is processed internally

```
1. Gather all `can` rules → combine with OR → this is the "allowed" set
2. Gather all `cannot` rules → combine with OR → this is the "denied" set
3. Final result = allowed AND NOT denied
```

```
┌──────────────┐   ┌──────────────────────┐
│   can rules  │   │   cannot rules       │
│  (what you   │   │  (what gets removed) │
│   CAN see)   │   │                      │
│              │   │                      │
│  { } (all)   │   │ { status:            │
│              │   │   'CLOSED_LOST' }    │
└──────┬───────┘   └──────────┬───────────┘
       │                      │
       │         AND          │ NOT
       ▼                      ▼
┌───────────────────────────────────────┐
│  { NOT: { status: 'CLOSED_LOST' } }  │
└───────────────────────────────────────┘
```

Your project doesn't currently use `cannot()`, but now you know how it works if you need it.

---

## 12. Pattern: Combining `accessibleBy` With Your Own Filters

In your `findAll()` service, you don't JUST use `accessibleBy`. You also add your own user filters (status, type, search, etc.).

Here is exactly how they combine:

```ts
// Build the where clause
const where: Prisma.EnquiryWhereInput = {};

// CASL authorization filter
if (ability) {
  try {
    where.AND = [accessibleBy(ability).Enquiry];
  } catch {
    return { items: [], meta: { page, limit, total: 0, totalPages: 0 } };
  }
}

// User-applied filters
if (status) where.status = status;
if (type) where.type = type;
if (assignedToId) where.assignedToId = assignedToId;
```

### How this produces the final query

**Scenario:** SALES user `u1`, filtering by `status = 'OPEN'`

Step 1: `accessibleBy(ability).Enquiry` → `{}` (SALES can read all)

Step 2: `where` object becomes:
```ts
{
  AND: [{}],          // from CASL (no restriction)
  status: 'OPEN',     // from user query parameter
}
```

Step 3: Prisma flattens this to:
```sql
SELECT * FROM "Enquiry" WHERE "status" = 'OPEN'
```

**Scenario:** Hypothetical where SALES can only read assigned enquiries, filtered by status:

Ability: `can('read', 'enquiry', { assignedToId: 'u1' })`

Step 1: `accessibleBy(ability, 'read').Enquiry` → `{ assignedToId: 'u1' }`

Step 2: `where` becomes:
```ts
{
  AND: [{ assignedToId: 'u1' }],  // from CASL
  status: 'OPEN',                  // from user query
}
```

Step 3: Prisma generates:
```sql
SELECT * FROM "Enquiry"
WHERE "assignedToId" = 'u1' AND "status" = 'OPEN'
```

### Why `where.AND = [...]` and not `where = accessibleBy(...).Enquiry`?

Because `AND` lets you **add** the CASL filter alongside your other filters without overwriting them.

If you did `where = accessibleBy(ability).Enquiry`, it would **replace** the entire where object, and you couldn't add status/type/search filters.

Using `AND` is the safe pattern:

```ts
// ✅ Safe — CASL filter AND your filters
where.AND = [accessibleBy(ability).Enquiry];
where.status = 'OPEN';

// Final: { AND: [{ ...casl }], status: 'OPEN' }
// Prisma interprets this as: caslFilter AND status = 'OPEN'
```

```ts
// ❌ Unsafe — overwrites everything
where = accessibleBy(ability).Enquiry;
where.status = 'OPEN';  // This MIGHT overwrite a key from accessibleBy!
```

---

## 13. Pattern: Single Record Access Check

For `findOne(id)`, `statusChange(id)`, `update(id)`, `delete(id)` — you're accessing ONE specific record.

### Pattern A: Query with both id AND accessibleBy

```ts
async findOne(id: string, ability: AppAbility) {
  const enquiry = await this.prisma.enquiry.findFirst({
    where: {
      id,                                    // "give me THIS specific enquiry"
      AND: [accessibleBy(ability).Enquiry],  // "but ONLY if I'm allowed to see it"
    },
  });

  if (!enquiry) {
    throw new NotFoundException('Enquiry not found or not accessible');
  }

  return enquiry;
}
```

**Why `findFirst` and not `findUnique`?**

`findUnique` only accepts unique fields in `where` (like `id`). It does NOT support `AND`. So we must use `findFirst`.

**What this generates:**

For SALES user `u1`, updating enquiry `enq-123`:

```ts
accessibleBy(ability, 'update').Enquiry → { assignedToId: 'u1' }
```

Prisma query:
```sql
SELECT * FROM "Enquiry"
WHERE "id" = 'enq-123' AND "assignedToId" = 'u1'
LIMIT 1
```

If `enq-123` is assigned to someone else → query returns null → throw NotFoundException.

If `enq-123` is assigned to `u1` → query returns the enquiry → proceed.

### Pattern B: Load first, then check

```ts
import { subject } from '@casl/ability';

const enquiry = await prisma.enquiry.findUnique({ where: { id } });

if (!enquiry) throw new NotFoundException();

if (!ability.can('update', subject('Enquiry', enquiry))) {
  throw new ForbiddenException();
}
```

This loads the record WITHOUT any filter, then manually checks `ability.can()` against the loaded instance.

`subject('Enquiry', enquiry)` wraps the raw data into a CASL subject so CASL can check the conditions against the actual record fields.

### When to use which?

| Pattern | Pros | Cons |
|---------|------|------|
| **A: Query with accessibleBy** | One DB call, cleaner | Can't distinguish "not found" from "forbidden" |
| **B: Load then check** | Can give specific error messages | Two operations (find + check) |

Pattern A is usually preferred in your codebase since it's simpler and more secure (no risk of forgetting the check).

---

## 14. Subject Naming: Why `'enquiry'` vs `.Enquiry`

This confuses everyone. Here's the definitive explanation.

### In three different places, the same thing has different names:

| Where | Name | Example |
|-------|------|---------|
| **Database** (Permission table) | lowercase string | `'enquiry'` |
| **CASL rules** (inside ability) | lowercase string | `can('read', 'enquiry')` |
| **`accessibleBy` property** | PascalCase (Prisma model name) | `.Enquiry` |
| **Prisma schema** | PascalCase | `model Enquiry { ... }` |
| **Prisma client** | camelCase | `prisma.enquiry.findMany(...)` |

### Why the difference?

The `@casl/prisma` library internally maps between them.

When you write `accessibleBy(ability).Enquiry`:
1. `.Enquiry` is the **Prisma model name** (PascalCase — matches `model Enquiry` in schema)
2. Internally, `@casl/prisma` converts this to lowercase (`'enquiry'`) to match your CASL rule subjects
3. It finds rules where `subject === 'enquiry'`
4. It generates a Prisma WHERE clause compatible with `prisma.enquiry.findMany()`

### The type connection

In your `casl.types.ts`:

```ts
export type AppSubjects =
  | 'enquiry'
  | 'message'
  | 'user'
  | 'contact'
  | 'dashboard'
  | 'all';

export type AppAbility = PureAbility<[Actions, AppSubjects], PrismaQuery>;
```

`PrismaQuery` from `@casl/prisma` is what enables the Prisma-style conditions and the `accessibleBy` function.

### Key rule

**Always make sure your subject string (stored in DB and used in `can()`) matches the lowercase version of your Prisma model name.**

```
model Enquiry → subject: 'enquiry' → accessibleBy().Enquiry  ✅
model Contact → subject: 'contact' → accessibleBy().Contact  ✅
```

If you have model `ConversationMessage`:
```
model ConversationMessage → subject: 'conversationmessage' → accessibleBy().ConversationMessage  ✅
```

But in your project, you use `'message'` as the subject, not `'conversationmessage'`. That's fine for `ability.can()` checks, but means you would need extra mapping if you ever use `accessibleBy(ability).ConversationMessage` — it would look for subject `'conversationmessage'` not `'message'`.

In practice, your project only uses `accessibleBy()` for `Enquiry`, so it works perfectly.

---

## 15. The Complete Internal Flow — Step by Step

Let me trace a COMPLETE request from HTTP to SQL.

### Request: `GET /enquiry?status=OPEN`
### User: SALES, userId = `u1`

```
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 1: HTTP Request arrives                                          │
│  GET /enquiry?status=OPEN                                              │
│  Header: Authorization: Bearer <jwt-token>                             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 2: JwtAuthGuard (global guard)                                   │
│  - Extracts JWT from header                                            │
│  - Validates signature and expiry                                      │
│  - Calls jwt.strategy.validate()                                       │
│  - Returns { userId: 'u1', role: 'SALES' }                            │
│  - Nest sets: request.user = { userId: 'u1', role: 'SALES' }          │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 3: CaslGuard runs (because @UseGuards(CaslGuard) on controller) │
│                                                                         │
│  3a. Read metadata from @CheckAbility({ action: 'read', subject: 'enquiry' })│
│      → { action: 'read', subject: 'enquiry' }                          │
│                                                                         │
│  3b. Call createForUser({ userId: 'u1', role: 'SALES' })               │
│                                                                         │
│  3c. Inside createForUser:                                              │
│      ┌───────────────────────────────────────────────────────┐         │
│      │ SQL: SELECT rp.*, p.*                                 │         │
│      │      FROM "RolePermission" rp                         │         │
│      │      JOIN "Permission" p ON rp."permissionId" = p.id  │         │
│      │      WHERE rp.role = 'SALES'                          │         │
│      │                                                       │         │
│      │ Returns 6 rows (read:enquiry, create:enquiry, etc.)   │         │
│      └───────────────────────────────────────────────────────┘         │
│                                                                         │
│  3d. Loop through results:                                              │
│      can('read', 'enquiry')                                            │
│      can('create', 'enquiry')                                          │
│      can('update', 'enquiry', { assignedToId: 'u1' })  ← placeholder resolved│
│      can('read', 'message')                                            │
│      can('create', 'message')                                          │
│      can('read', 'dashboard')                                          │
│                                                                         │
│  3e. build() → ability object with 6 rules                             │
│                                                                         │
│  3f. Check: ability.can('read', 'enquiry') → TRUE                      │
│      (because rule exists: can('read', 'enquiry'))                     │
│                                                                         │
│  3g. request.ability = ability                                          │
│  3h. Guard returns true → request continues                             │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 4: Controller method runs                                        │
│                                                                         │
│  findAll(@Query() query, @Req() req) {                                 │
│    return this.enquiryService.findAll(query, req.ability);              │
│  }                                                                      │
│                                                                         │
│  query = { status: 'OPEN' }                                            │
│  req.ability = <the ability object from step 3>                         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 5: Service findAll() runs                                        │
│                                                                         │
│  5a. const where = {};                                                 │
│                                                                         │
│  5b. accessibleBy(ability).Enquiry                                     │
│      ┌───────────────────────────────────────────────────────┐         │
│      │ CASL internally:                                      │         │
│      │ 1. Subject 'Enquiry' → look for 'enquiry' rules      │         │
│      │ 2. Found rules:                                       │         │
│      │    - read:enquiry (no condition)                       │         │
│      │    - create:enquiry (no condition)                     │         │
│      │    - update:enquiry ({ assignedToId: 'u1' })          │         │
│      │ 3. At least one rule has no condition → ALL access     │         │
│      │ 4. Return: {}                                          │         │
│      └───────────────────────────────────────────────────────┘         │
│                                                                         │
│  5c. where.AND = [{}];  ← CASL filter (no restriction)                │
│  5d. where.status = 'OPEN';  ← user filter                            │
│                                                                         │
│  5e. Final where object:                                               │
│      { AND: [{}], status: 'OPEN' }                                     │
│                                                                         │
│  5f. prisma.enquiry.findMany({ where })                                │
│      ┌───────────────────────────────────────────────────────┐         │
│      │ SQL: SELECT * FROM "Enquiry"                          │         │
│      │      WHERE "status" = 'OPEN'                          │         │
│      └───────────────────────────────────────────────────────┘         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  STEP 6: Database returns rows matching status = OPEN                  │
│  Response sent to client                                               │
└─────────────────────────────────────────────────────────────────────────┘
```

### Now let's see the SAME flow but for a RESTRICTED scenario

Imagine SALES user `u1` can ONLY read assigned enquiries:

```ts
can('read', 'enquiry', { assignedToId: 'u1' });
// No unconditional read rule
```

Everything stays the same except step 5b:

```
5b. accessibleBy(ability).Enquiry
    1. Found rule: read:enquiry with condition { assignedToId: 'u1' }
    2. Only one rule, condition present
    3. Return: { assignedToId: 'u1' }

5c. where.AND = [{ assignedToId: 'u1' }];
5d. where.status = 'OPEN';

5e. Final where: { AND: [{ assignedToId: 'u1' }], status: 'OPEN' }

SQL: SELECT * FROM "Enquiry"
     WHERE "assignedToId" = 'u1' AND "status" = 'OPEN'
```

Now the user ONLY sees their own open enquiries. One line of code change in the database, zero code changes in the service.

---

## 16. Common Mistakes and How to Avoid Them

### Mistake 1: Using `accessibleBy` without try/catch

```ts
// ❌ DANGEROUS — crashes if user has NO rules for this subject
where.AND = [accessibleBy(ability).Enquiry];
```

If the user has absolutely no `enquiry` rules (maybe a new role like `VIEWER`), `accessibleBy` throws `ForbiddenError`.

```ts
// ✅ SAFE — returns empty list on no access
try {
  where.AND = [accessibleBy(ability).Enquiry];
} catch {
  return { items: [], meta: { page, limit, total: 0, totalPages: 0 } };
}
```

### Mistake 2: Using `accessibleBy` at route level instead of `ability.can()`

```ts
// ❌ WRONG — accessibleBy is for database queries, not route checks
if (accessibleBy(ability).Enquiry) { ... }
```

```ts
// ✅ CORRECT — ability.can() is for yes/no checks
if (ability.can('read', 'enquiry')) { ... }
```

### Mistake 3: Thinking `@CheckAbility()` on the route is enough

```ts
// ❌ NOT ENOUGH — route guard only checks "can this role do this action"
@CheckAbility({ action: 'update', subject: 'enquiry' })
async update(id, dto) {
  return prisma.enquiry.update({ where: { id }, data: dto });
  // SALES user can now update ANY enquiry, not just their assigned ones!
}
```

```ts
// ✅ CORRECT — service also checks conditions
@CheckAbility({ action: 'update', subject: 'enquiry' })
async update(id, dto, ability) {
  const enquiry = await prisma.enquiry.findFirst({
    where: {
      id,
      AND: [accessibleBy(ability, 'update').Enquiry],
    },
  });
  if (!enquiry) throw new ForbiddenException();
  return prisma.enquiry.update({ where: { id }, data: dto });
}
```

### Mistake 4: Subject name mismatch

```ts
// In database:
{ action: 'read', subject: 'enquiry' }  // lowercase

// In accessibleBy:
accessibleBy(ability).enquiry  // ❌ lowercase 'e' — won't match Prisma model
accessibleBy(ability).Enquiry  // ✅ PascalCase — matches Prisma model name
```

### Mistake 5: Forgetting that `accessibleBy()` without action considers ALL actions

```ts
// This considers ALL rules (read, update, create) for enquiry
accessibleBy(ability).Enquiry

// This considers ONLY read rules
accessibleBy(ability, 'read').Enquiry

// For findAll() endpoint, you usually want 'read'
accessibleBy(ability, 'read').Enquiry  // ← more precise
```

---

## 17. Quick Reference Cheat Sheet

### Building Abilities

```ts
// In casl-ability.factory.ts — runs per request by CaslGuard

can('read', 'enquiry');                           // allow read ALL enquiries
can('update', 'enquiry', { assignedToId: 'u1' }); // allow update ONLY assigned
can('manage', 'all');                              // superadmin — everything
cannot('read', 'enquiry', { status: 'CLOSED_LOST' }); // deny specific subset
```

### Route-Level Check (Guard)

```ts
// In controller — stops unauthorized users quickly
@CheckAbility({ action: 'read', subject: 'enquiry' })
```

### Data-Level Filter (Service)

```ts
// List queries — filter rows by ability
where.AND = [accessibleBy(ability).Enquiry];

// With specific action
where.AND = [accessibleBy(ability, 'update').Enquiry];

// Single record check
const record = await prisma.enquiry.findFirst({
  where: { id, AND: [accessibleBy(ability, 'update').Enquiry] },
});
```

### Rule Combination Summary

```
┌──────────────────────────────────────────────────────────┐
│  CASL Rule Combining Logic                               │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Multiple `can` rules for same subject:                  │
│    → Combined with OR (more rules = more access)         │
│                                                          │
│  Multiple keys in ONE condition:                         │
│    → Combined with AND (all must match)                  │
│                                                          │
│  `can` + `cannot` rules:                                 │
│    → can_result AND NOT cannot_result                    │
│                                                          │
│  One rule has no condition:                              │
│    → That action has full access (condition-less OR      │
│      anything = everything)                              │
│                                                          │
│  No matching rules at all:                               │
│    → accessibleBy THROWS error (use try/catch)           │
│    → ability.can() returns false                         │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Type Definitions At a Glance

```ts
// casl.types.ts
type Actions   = 'create' | 'read' | 'update' | 'delete' | 'assign' | 'merge' | 'manage';
type AppSubjects = 'enquiry' | 'message' | 'user' | 'contact' | 'dashboard' | ... | 'all';
type AppAbility = PureAbility<[Actions, AppSubjects], PrismaQuery>;
//                                                     ^^^^^^^^^^
//                    This PrismaQuery is what makes accessibleBy() work.
//                    Without it, conditions would be plain JS objects,
//                    not Prisma-compatible query filters.
```

### The `createPrismaAbility` Connection

```ts
// In casl-ability.factory.ts
const { can, cannot, build } = new AbilityBuilder<AppAbility>(
  createPrismaAbility as any,  // ← THIS links CASL to Prisma
);
```

Without `createPrismaAbility`:
- `can('read', 'enquiry', { assignedToId: 'u1' })` stores a plain JS condition
- `accessibleBy()` would NOT work
- You could only use `ability.can()` for boolean checks

With `createPrismaAbility`:
- Conditions are stored as Prisma-compatible query fragments
- `accessibleBy()` can convert them to real Prisma WHERE clauses
- Everything works end-to-end

### Quick Decision Tree

```
Need to check "can user access this route at all?"
  → Use @CheckAbility() decorator + CaslGuard
  → Example: @CheckAbility({ action: 'read', subject: 'enquiry' })

Need to filter database rows by permission?
  → Use accessibleBy(ability).ModelName in the WHERE clause
  → Example: where.AND = [accessibleBy(ability).Enquiry]

Need to check permission on a specific loaded record?
  → Use ability.can(action, subject('ModelName', record))
  → Example: ability.can('update', subject('Enquiry', loadedEnquiry))

Need to check permission + get a specific record from DB?
  → Use findFirst with both id AND accessibleBy
  → Example: findFirst({ where: { id, AND: [accessibleBy(ability).Enquiry] } })
```

---

## Final Word

The entire CASL system in your project boils down to this:

1. **Database stores rules** → "SALES can update enquiry WHERE assignedToId = $userId"
2. **Factory builds ability** → replaces `$userId` with real user ID, creates rule list
3. **Guard checks route** → "does this user have ANY rule for this action+subject?"
4. **Service filters data** → `accessibleBy` converts rules into Prisma WHERE clause

Every time you write `accessibleBy(ability).Enquiry`, you are telling CASL:
> "Look at all the rules you have for this user, find the ones about enquiries, extract their conditions, combine them with OR, and give me a Prisma WHERE clause."

That's it. No magic. Just rule → query translation.

Now go build. 🚀
