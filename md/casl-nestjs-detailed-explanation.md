# NestJS Decorators and CASL in This Project

This file explains your actual codebase, not just generic NestJS or CASL theory.

The main goal is to answer these doubts:

1. How NestJS decorators work.
2. How to create custom decorators.
3. What happens internally when decorators run.
4. How your `createForUser()` in CASL works.
5. How `@CheckAbility()` + `CaslGuard` work together.
6. How `accessibleBy()` works and when to use it.
7. Whether every request builds an ability and whether that is scalable.

---

## 1. Big Picture of Your Auth + CASL Flow

In your project, a protected request generally flows like this:

1. Request comes to Nest.
2. Global `JwtAuthGuard` runs first because it is registered as `APP_GUARD` in `backend/src/app.module.ts`.
3. If route is not `@Public()`, JWT is validated and `request.user` is set.
4. Controller-level `@UseGuards(CaslGuard)` runs.
5. `CaslGuard` reads metadata set by `@CheckAbility(...)`.
6. `CaslGuard` calls `CaslAbilityFactory.createForUser(request.user)`.
7. CASL ability is built from DB permissions for that role.
8. Guard checks `ability.can(action, subject)`.
9. If allowed, guard stores `request.ability = ability`.
10. Controller method runs.
11. Service can optionally use `request.ability` with `accessibleBy(ability)` to filter database rows.

Important:

- `@CheckAbility()` is route-level permission checking.
- `accessibleBy()` is data-level filtering.
- These are related, but not the same thing.

That distinction is where most confusion happens.

---

## 2. How Decorators Work in NestJS

### What a decorator is

A decorator is just a function that attaches metadata or changes behavior on:

- a class
- a method
- a parameter
- a property

NestJS uses decorators heavily because it is built on top of TypeScript decorators plus reflection metadata.

Examples:

- `@Controller('enquiry')`
- `@Get()`
- `@UseGuards(CaslGuard)`
- `@Body()`
- `@Param('id')`
- your custom `@CheckAbility(...)`
- your custom `@Ability()`

### What decorators usually do in Nest

Most Nest decorators do one of these:

1. Attach metadata
2. Register a route
3. Tell Nest how to inject something
4. Tell Nest which guard/interceptor/pipe/filter to run

### Simple mental model

When Nest loads your app, it scans classes and methods.

Decorators leave instructions behind. Nest reads those instructions later.

So:

- decorator itself usually does not execute business logic for each request
- it mostly stores metadata during class definition / app bootstrap
- guards/interceptors/pipes later read that metadata at request time

---

## 3. Your `@CheckAbility()` Decorator

File: `backend/src/modules/casl/decorators/check-ability.decorator.ts`

```ts
import { SetMetadata } from '@nestjs/common';

export const CHECK_ABILITY_KEY = 'check_ability';

export interface AbilityCheck {
  action: string;
  subject: string;
  field?: string;
}

export const CheckAbility = (abilityCheck: AbilityCheck) =>
  SetMetadata(CHECK_ABILITY_KEY, abilityCheck);
```

### What this does

This decorator does not check permissions by itself.

It only stores metadata on the route handler.

For example:

```ts
@Get()
@CheckAbility({ action: 'read', subject: 'enquiry' })
findAll() {}
```

This means:

- Nest stores `{ action: 'read', subject: 'enquiry' }`
- later, `CaslGuard` reads it using `Reflector`

### Internally what happens

`SetMetadata(key, value)` returns a decorator function.

That function is attached to the method and stores:

- key: `check_ability`
- value: `{ action: 'read', subject: 'enquiry' }`

Later:

```ts
const abilityCheck = this.reflector.get(
  CHECK_ABILITY_KEY,
  context.getHandler(),
);
```

That is how your guard gets the value.

So the process is:

1. `@CheckAbility()` writes metadata.
2. `CaslGuard` reads metadata.
3. `CaslGuard` performs the real authorization.

---

## 4. How to Create Your Own Decorators

There are two common custom decorator types in Nest:

### A. Metadata decorator

Use this when you want a guard/interceptor/filter to read something later.

Example:

```ts
import { SetMetadata } from '@nestjs/common';

export const MY_KEY = 'my_key';
export const MyDecorator = (value: string) => SetMetadata(MY_KEY, value);
```

Usage:

```ts
@MyDecorator('admin-only')
someRoute() {}
```

Read later in a guard:

```ts
const value = this.reflector.get(MY_KEY, context.getHandler());
```

This is exactly the pattern your `@CheckAbility()` uses.

### B. Parameter decorator

Use this when you want to inject something into a controller method parameter.

Your project has this:

File: `backend/src/modules/casl/decorators/ability.decorator.ts`

```ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppAbility } from '../casl.types';

export const Ability = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AppAbility => {
    const request = ctx.switchToHttp().getRequest();
    return request.ability;
  },
);
```

Usage would be:

```ts
findAll(@Ability() ability: AppAbility) {
  return this.enquiryService.findAll(query, ability);
}
```

### What this does internally

At request time, Nest sees `@Ability()` on a parameter.

It runs the factory function:

```ts
(data, ctx) => {
  const request = ctx.switchToHttp().getRequest();
  return request.ability;
}
```

So `ability` gets injected from `request.ability`.

In your codebase, `request.ability` is populated by `CaslGuard`.

---

## 5. Your JWT Guard Runs Before CASL

Files:

- `backend/src/app.module.ts`
- `backend/src/modules/auth/guards/jwt-auth.guard.ts`
- `backend/src/modules/auth/strategies/jwt.strategy.ts`

### What happens

In `AppModule`:

```ts
{
  provide: APP_GUARD,
  useClass: JwtAuthGuard,
}
```

This makes JWT guard global.

So for almost every request:

1. `JwtAuthGuard` runs first
2. if route has `@Public()`, it skips auth
3. otherwise passport JWT strategy validates token
4. `validate(payload)` returns:

```ts
{
  userId: payload.sub,
  role: payload.role,
}
```

5. Nest attaches that object as `request.user`

So when `CaslGuard` runs later, it can access:

```ts
const user = request.user;
```

Without JWT guard, your CASL guard would not know who the user is.

---

## 6. Your `CaslGuard` Step by Step

File: `backend/src/modules/casl/casl.guard.ts`

Core logic:

```ts
const abilityCheck = this.reflector.get(
  CHECK_ABILITY_KEY,
  context.getHandler(),
);
```

This reads metadata from `@CheckAbility(...)`.

Then:

```ts
const request = context.switchToHttp().getRequest();
const user = request.user;
```

This reads the authenticated user from JWT guard.

Then:

```ts
const ability = await this.caslAbilityFactory.createForUser(user);
```

This builds the CASL ability for that user.

Then:

```ts
if (!ability.can(action, subject, field)) {
  throw new ForbiddenException(...);
}
```

This checks whether the ability allows the route.

Then:

```ts
request.ability = ability;
```

This makes the built ability available to the controller/service later.

### Important limitation of this guard

Right now your guard checks:

```ts
ability.can(action, subject)
```

It does not check a specific database record instance here.

That means this guard answers:

- "Can this user perform `read` on subject `enquiry` in general?"

It does not automatically answer:

- "Can this user read enquiry with id `abc123`?"

For record-level restrictions, you must either:

1. use `accessibleBy()` in DB queries, or
2. load the record and call `ability.can(action, subjectInstance)` in service code

Your current project mostly does option 1 only in one place: `findAll()`.

---

## 7. Your `createForUser()` in CASL Ability Factory

File: `backend/src/modules/casl/casl-ability.factory.ts`

```ts
async createForUser(user: AuthUser): Promise<AppAbility> {
  const { can, cannot, build } = new AbilityBuilder<AppAbility>(
    createPrismaAbility as any,
  );

  const rolePermissions = await this.prisma.rolePermission.findMany({
    where: { role: user.role },
    include: { permission: true },
  });

  for (const rp of rolePermissions) {
    const action = rp.permission.action.toLowerCase() as Actions;
    const subject = rp.permission.subject.toLowerCase() as AppSubjects;

    let conditions = rp.conditions as any;

    if (conditions) {
      conditions = this.resolvePlaceholders(conditions, user);
    }

    if (action === 'manage' && subject === 'all') {
      can('manage', 'all');
    } else {
      can(action, subject, conditions || undefined);
    }
  }

  return build();
}
```

### What this is doing

This function builds ability rules dynamically from the database.

It does not hardcode permissions in TypeScript.

Instead it:

1. finds all `RolePermission` rows for the user's role
2. joins the related `Permission`
3. converts DB values into CASL rules using `can(...)`
4. builds and returns the final ability object

### Example using your seed file

In `backend/prisma/seed-permissions.ts`, SALES has:

```ts
{ action: 'update', subject: 'enquiry', conditions: { assignedToId: '$userId' } }
```

When SALES user with `userId = u1` logs in, this becomes:

```ts
can('update', 'enquiry', { assignedToId: 'u1' });
```

So the ability means:

- sales can update enquiry
- but only when `assignedToId` equals that user id

### Why `resolvePlaceholders()` exists

DB stores reusable placeholders:

```json
{ "assignedToId": "$userId" }
```

At request time your code replaces `$userId` with actual logged-in user id.

That makes one permission template reusable for all users of that role.

---

## 8. What `createPrismaAbility()` Gives You

You are using:

```ts
import { createPrismaAbility } from '@casl/prisma';
```

This matters because your conditions are Prisma-style conditions.

That is what allows:

- `ability.can(...)` logic
- `accessibleBy(ability)` query generation

In other words, CASL is not just storing booleans.
It is storing rule conditions that can later be converted into Prisma `where` filters.

---

## 9. `@CheckAbility()` vs `accessibleBy()` 

This is the most important distinction.

### `@CheckAbility()`

Used at controller/route level.

Example:

```ts
@Get()
@CheckAbility({ action: 'read', subject: 'enquiry' })
findAll() {}
```

This checks:

- does user have permission to perform `read` on `enquiry` at all?

It does not automatically filter which rows are visible.

### `accessibleBy()`

Used in service/repository query building.

Example from your `findAll()`:

```ts
where.AND = [accessibleBy(ability).Enquiry];
```

This converts CASL rules into Prisma `where`.

If SALES has:

```ts
can('update', 'enquiry', { assignedToId: 'u1' });
can('read', 'enquiry');
```

then `accessibleBy(ability).Enquiry` tries to build the Prisma filter for the relevant rules.

### Why you need both

Use `@CheckAbility()` when you want to stop completely unauthorized routes fast.

Use `accessibleBy()` when you want only allowed records returned from DB.

Typical pattern:

1. Guard says user is allowed to access this route.
2. Service applies `accessibleBy()` so DB returns only allowed rows.

If you only do step 1, user may still access records they should not see.

---

## 10. How `accessibleBy()` Works

In your service:

```ts
if (ability) {
  try {
    where.AND = [accessibleBy(ability).Enquiry];
  } catch {
    return { items: [], meta: { page, limit, total: 0, totalPages: 0 } };
  }
}
```

### What this means
 
CASL looks at the built ability rules and tries to generate a Prisma filter for subject `Enquiry`.

Conceptually it becomes something like:

```ts
{
  OR: [
    { assignedToId: 'u1' },
    ...
  ]
}
```

Exact generated query depends on rules.

### When to use it

Use `accessibleBy()` for queries like:

- list enquiries user can see
- count enquiries user can see
- fetch only records matching ability constraints

Good use cases:

- `findMany`
- `count`
- `aggregate`
- dashboard queries

### When not enough by itself

For single-item operations like:

- `findOne(id)`
- `update(id, ...)`
- `delete(id)`

you usually need one of these patterns:

#### Pattern A: query with both id and accessibleBy

```ts
const enquiry = await prisma.enquiry.findFirst({
  where: {
    id,
    AND: [accessibleBy(ability).Enquiry],
  },
});
```

If result is null, user either does not have access or record does not exist.

#### Pattern B: load instance and call `ability.can(...)`

```ts
const enquiry = await prisma.enquiry.findUnique({ where: { id } });

if (!enquiry) throw new NotFoundException();

if (!ability.can('update', subject('Enquiry', enquiry))) {
  throw new ForbiddenException();
}
```

Pattern A is usually cleaner for Prisma when your rules are query-shaped.

---

## 11. How Your Controller Is Currently Using CASL

Example from `EnquiryController`:

```ts
@Get()
@CheckAbility({ action: 'read', subject: 'enquiry' })
findAll(@Query() query: InboxQueryDto, @Req() req: Request) {
  return this.enquiryService.findAll(query, req.ability);
}
```

### What happens here

1. `CaslGuard` ensures route-level `read enquiry` is allowed.
2. `CaslGuard` stores `req.ability`.
3. Service uses `req.ability` with `accessibleBy()`.
4. DB list is filtered.

This is the correct idea.

### Cleaner version with your custom param decorator

You already created `@Ability()` but are not using it here.

You could write:

```ts
findAll(
  @Query() query: InboxQueryDto,
  @Ability() ability: AppAbility,
) {
  return this.enquiryService.findAll(query, ability);
}
```

This is cleaner than using `@Req() req`.

---

## 12. Very Important: What Is Not Fully Enforced in Current Code

This part matters a lot.

Your current setup gives route-level authorization, but record-level authorization is incomplete in several places.

### `findAll()` is the main place where row filtering happens

This is good:

```ts
where.AND = [accessibleBy(ability).Enquiry];
```

### But `findOne(id)` is not filtered by ability

Current code:

```ts
async findOne(id: string) {
  const enquiry = await this.prisma.enquiry.findUnique({ where: { id }, ... });
}
```

Problem:

- if a user passes route-level `read enquiry`
- this method does not verify record-level condition
- so a restricted user may read any enquiry by id

### `statusChange()` receives ability but does not use it

Current signature:

```ts
async statusChange(id, dto, ability?: AppAbility, userId?: string)
```

But inside, `ability` is ignored.

Problem:

- SALES may have `update enquiry` only when `assignedToId = userId`
- route guard allows `update enquiry` in general
- service is not checking whether this specific enquiry is assigned to that user

So conditions are not being enforced here.

### `assign()` has no instance-level authorization check

Route checks only:

```ts
@CheckAbility({ action: 'assign', subject: 'enquiry' })
```

But service does not verify any per-record rule.

### `getMessages(id)` has no enquiry-level record check

Even if user can `read message`, service does not ensure the parent enquiry is accessible.

### `getEnquiriesByContact()` ignores ability entirely

Current code:

```ts
getEnquiriesByContact(contactId, req.user) {
  return this.enquiryService.getEnquiriesByContact(contactId, req.user);
}
```

But service method does not use ability or user restrictions.

### Main lesson

`@CheckAbility()` is not enough for conditional access.

If conditions matter, service/query must enforce them too.

---

## 13. Why Route-Level Check Can Pass Even When Instance Should Fail

Suppose SALES has:

```ts
can('update', 'enquiry', { assignedToId: 'u1' });
```

Now route has:

```ts
@CheckAbility({ action: 'update', subject: 'enquiry' })
```

Guard does:

```ts
ability.can('update', 'enquiry')
```

This is a subject-level check, not a record-level check.

So the answer may be "yes, this user has some `update enquiry` permission".

But the actual record may belong to another assignee.

That is why the service must still enforce condition for the specific record.

---

## 14. How to Think About CASL Correctly

Use two layers:

### Layer 1: route authorization

Handled by guard + decorator.

Purpose:

- stop obviously unauthorized access quickly
- keep controller intent readable

Example:

```ts
@CheckAbility({ action: 'update', subject: 'enquiry' })
```

### Layer 2: record/data authorization

Handled by service/repository using:

- `accessibleBy(ability)`
- or `ability.can(...)` against actual instance

Purpose:

- enforce ownership
- enforce assignment rules
- enforce row-level security

If you remember only one thing, remember this:

`@CheckAbility()` says "this kind of operation is allowed".

`accessibleBy()` says "these exact rows are allowed".

---

## 15. Example of a Safer Pattern for Your Service

For `findOne(id)`:

```ts
async findOne(id: string, ability: AppAbility) {
  const enquiry = await this.prisma.enquiry.findFirst({
    where: {
      id,
      AND: [accessibleBy(ability).Enquiry],
    },
    include: {
      contact: { include: { channels: true } },
      assignedTo: { select: { id: true, displayName: true, userName: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          sentByUser: {
            select: { id: true, displayName: true, userName: true },
          },
        },
      },
      timeline: {
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      notes: {
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!enquiry) {
    throw new NotFoundException('Enquiry not found or not accessible');
  }

  return enquiry;
}
```

For `statusChange(id, ...)`:

```ts
const enquiry = await this.prisma.enquiry.findFirst({
  where: {
    id,
    AND: [accessibleBy(ability).Enquiry],
  },
});

if (!enquiry) {
  throw new ForbiddenException('You cannot update this enquiry');
}
```

This is where conditional permission actually becomes real enforcement.

---

## 16. Does Every Request Build Ability Again?

Short answer: yes, in your current setup, each request protected by `CaslGuard` builds the ability again.

Because this runs per request:

```ts
const ability = await this.caslAbilityFactory.createForUser(user);
```

And inside that you query DB:

```ts
await this.prisma.rolePermission.findMany(...)
```

### Is that normal?

Yes, building ability per request is common.

But whether it is expensive depends on how you do it.

### In your current code, the expensive part is not CASL itself

CASL rule building is cheap.

The more expensive part is:

- DB query to load role permissions on every request

### Is it scalable?

For small or medium systems, usually yes.

Why:

- number of permissions per role is usually small
- ability objects are small
- role-based permissions change infrequently

### What can become inefficient

If every request does:

1. JWT auth
2. DB fetch role permissions
3. build ability

then under heavy traffic, repeated permission lookups for same role are wasteful.

---

## 17. Better Scaling Strategies

### Option 1: Cache permissions by role

Best fit for your current design.

Idea:

- cache `rolePermission.findMany({ where: { role } })`
- TTL maybe 1 to 5 minutes
- invalidate when permissions are updated

Then each request still builds ability, but from cached role permissions, not DB.

This is the most practical improvement.

### Option 2: Put permission snapshot into JWT

Possible, but usually worse if permissions can change often.

Problem:

- permission change requires token refresh
- token becomes larger
- harder to manage centrally

Usually not the best first choice.

### Option 3: Cache fully built ability per role

Possible only if rules are role-only.

In your case some rules depend on user-specific placeholders like `$userId`.

So full ability caching per role alone is not enough.

But you can still:

1. cache raw role permissions by role
2. substitute placeholders per request
3. build ability quickly

That is a good design.

### Option 4: Build ability once per request and reuse it everywhere

You already do this correctly by storing:

```ts
request.ability = ability;
```

That avoids rebuilding multiple times inside the same request.

---

## 18. Recommended Mental Model for Scaling

Think of it like this:

- authenticate per request
- authorize per request
- but do not fetch static role definitions from DB per request if avoidable

Best balance:

1. cache role permission rows
2. resolve placeholders with current user
3. build request ability
4. use same ability for all controller/service checks in that request

That scales well for most business apps.

---

## 19. Full Request Example in Your Project

Take this route:

```ts
@Get()
@CheckAbility({ action: 'read', subject: 'enquiry' })
findAll(@Query() query: InboxQueryDto, @Req() req: Request) {
  return this.enquiryService.findAll(query, req.ability);
}
```

### Step by step

1. Client sends `GET /enquiry` with Bearer token.
2. Global `JwtAuthGuard` runs.
3. JWT strategy validates token and returns:

```ts
{ userId, role }
```

4. Nest stores that as `request.user`.
5. `CaslGuard` runs because controller has `@UseGuards(CaslGuard)`.
6. Guard reads metadata from `@CheckAbility(...)`.
7. Guard calls `createForUser(request.user)`.
8. Ability factory loads role permissions from DB.
9. Placeholder like `$userId` is replaced with real user id.
10. Ability is built.
11. Guard checks `ability.can('read', 'enquiry')`.
12. If allowed, `request.ability = ability`.
13. Controller runs.
14. Service calls `accessibleBy(ability).Enquiry`.
15. Prisma query gets filtered to allowed rows.
16. Response returns only accessible enquiries.

This is the clean full flow.

---

## 20. Example: Why `findAll()` Is Better Than `findOne()` Right Now

### `findAll()`

Current code applies:

```ts
accessibleBy(ability).Enquiry
```

So DB rows are filtered.

### `findOne(id)`

Current code only fetches by id:

```ts
findUnique({ where: { id } })
```

This means if user can pass the route-level guard, record-level restriction is not enforced.

So in your code today:

- list endpoint is closer to proper row-level authorization
- single-item endpoint is weaker

---

## 21. About `cannot(...)`

Your factory extracts:

```ts
const { can, cannot, build } = new AbilityBuilder(...)
```

But `cannot` is not currently used.

CASL supports deny rules too, for example:

```ts
can('read', 'enquiry');
cannot('read', 'enquiry', { status: 'CLOSED_LOST' });
```

That can be useful when you want broad allow with specific deny.

Not required, but good to know.

---

## 22. Why Subject Naming Matters

Your types use lowercase string subjects:

```ts
'enquiry' | 'message' | 'contact' | ...
```

But `accessibleBy(ability).Enquiry` uses Prisma model name `Enquiry`.

This can be confusing.

Why it works conceptually:

- CASL subject names describe permission domain
- Prisma helper maps to Prisma model filters

But you must stay consistent.

If subject names and Prisma model expectations drift apart, authorization becomes fragile.

---

## 23. How You Could Explain This to Yourself in One Sentence

In your project:

- decorators declare intent
- guards read decorator metadata
- ability factory builds permissions from DB
- guard checks route access
- services must enforce row-level access with `accessibleBy()` or instance checks

That is the whole system.

---

## 24. Practical Rules You Should Follow

### Rule 1

Use `@CheckAbility()` on routes to state required action + subject.

### Rule 2

If permission has conditions, enforce them in service/query too.

### Rule 3

For list endpoints, prefer `accessibleBy()`.

### Rule 4

For single-record read/update/delete, query with both `id` and `accessibleBy()`, or check loaded instance.

### Rule 5

Do not assume route guard alone enforces ownership/assignment conditions.

### Rule 6

Cache role permissions by role if DB lookup per request becomes hot.

---

## 25. Direct Answers to Your Exact Questions

### "How does decorator work in NestJS?"

Decorator usually stores metadata or tells Nest how to handle a class/method/parameter. Nest later reads that metadata during app bootstrap or request handling.

### "How to create different decorator?"

Use:

- `SetMetadata()` for method/class metadata decorators
- `createParamDecorator()` for custom parameter injection decorators

### "How is it created internally?"

It is just a function returning another function. Nest/TypeScript attach metadata, and later `Reflector` or Nest internals read it.

### "We create `createForUser` in CASL ability file and use guard on controller. How does that get checked?"

`@CheckAbility(...)` stores metadata. `CaslGuard` reads it with `Reflector`, builds ability via `createForUser(user)`, then calls `ability.can(...)`.

### "Controller just checks then for condition we apply in service?"

Yes. In your current architecture:

- controller/guard checks permission type
- service should enforce record-level conditions

That is the correct separation.

### "How `accessibleBy` is used?"

It converts CASL ability rules into Prisma `where` filters so DB returns only records allowed by permission conditions.

### "When to use it?"

Use it whenever data visibility depends on conditions like:

- assigned user
- owner id
- department
- status restrictions

Especially for list and query endpoints.

### "Will each request build the ability for that role?"

Yes, in your current code.

### "Isn't that hard to scale?"

Building the ability itself is cheap. Re-fetching permissions from DB on every request is the part that can become wasteful. The normal solution is caching role permissions.

---

## 26. Final Summary

Your current system is structurally correct:

- JWT authenticates
- CASL guard authorizes route
- service can filter rows

But the important gap is this:

conditional rules defined in `createForUser()` are only fully effective when service queries also enforce them.

Right now, `findAll()` does that, but several other methods do not.

So if your doubt was:

"If CASL rule says SALES can update only assigned enquiries, where is that actually enforced?"

Answer:

- partially in the ability
- but in practice only where your service uses that ability to filter/check specific records
- not automatically everywhere

That is the key point.
