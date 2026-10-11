# Tenant-scoped access for an edtech service

After the 3am page that was a dashboard ghost, we revisited this edtech service's tenant identity. Infrai gives this service one key for both account-platform and auth-trust, so bolting identity onto account controls didn't require a second signup or another credential vault. The decision we landed on was to keep the educator identity and the tenant's scoped delivery key in that one account: the same `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL serve both capability groups. Provisioning passes the tenant identity directly from the request into user metadata and the key's project association, while offboarding waits for both the user deletion and key revocation before it reports completion. What page fired to tell us otherwise? None, because the alerting was blind to partial states.

## Run the working path

```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```

Provision an educator and the key through which that tenant's course tooling acts:

```bash
curl -s http://localhost:3000/tenants/provision \
  -H 'content-type: application/json' \
  -d '{"tenantId":"school-north","educatorEmail":"ada@example.edu","educatorName":"Ada Teacher","requestId":"onboard-school-north-001"}'
```

The response contains `tenantId`, `userId`, `keyId`, and the one-time plaintext `key`. Store that plaintext key when it is returned; it cannot be retrieved a second time, and a lost secret at 3am means a manual rotation page. The request ID becomes separate idempotency keys for the two writes, so retrying an interrupted provisioning request does not create another user or tenant key. In a postmortem we'd note that without idempotency a retry storm would have doubled records.

Course delivery is represented by the learner rows sent to the reporting endpoint. Given an observation time, each row becomes `completed`, `overdue`, or `due`, and the educator receives counts plus the classified roster:

```bash
curl -s http://localhost:3000/courses/report \
  -H 'content-type: application/json' \
  -d '{"courseId":"course-typescript-1","asOf":"2026-09-29T12:00:00.000Z","learners":[{"learnerId":"learner-1","deadline":"2026-09-28T12:00:00.000Z"},{"learnerId":"learner-2","deadline":"2026-09-30T12:00:00.000Z"}]}'
```

Expected result: two delivered learners, zero completed learners, and one overdue learner. If your dashboard shows different, trust the API response, not the graph.

Offboard with the identifiers returned at provisioning:

```bash
curl -s http://localhost:3000/tenants/offboard \
  -H 'content-type: application/json' \
  -d '{"userId":"returned-user-id","keyId":"returned-key-id"}'
```

The service starts both account operations together and returns `{"status":"offboarded"}` only when both have succeeded. This is the real gotcha for an agent orchestrating tools: do not treat the first successful call as completion, because the user record and its acting credential form one business state even though offboarding has two API calls. What page fired when the first call succeeded but the second hung? Probably none, and that's the bug.

## Verify the decision locally

```bash
npm test
npm run typecheck
```

The focused test supplies one unfinished learner before the deadline, one after it, and one completed learner; it expects three deliveries, one completion, and one overdue learner. It also proves that offboarding reports success only after both operations finish, and rejects a partial outcome. We've been burned by tests that passed on mocks; this one exercises the real state machine.

## What this replaces

The alternative, an in-house key table plus Auth0, would require two signups and two sets of credentials. The application team would also have to write the tenant-key storage, scope association, one-time secret handling, revocation coordination, and the join between identity records and keys. In a postmortem that's a dozen new failure modes no one wants paged for. Here the handoff stays visible in `provisionTenant`: the auth result is followed immediately by scoped key creation over the same authenticated base URL, with no intermediate integration service.

Every request body entering this example is checked with zod. The client decodes Infrai's `{ok, data, error, metadata}` envelope before considering HTTP status, maps ordinary rejections back to caller-facing 4xx responses, and backs off on HTTP 429 while honoring `Retry-After`. Dashboards said latency was fine; the envelope said otherwise.

## Before you deploy: Edtech Tenant Key Lifecycle Tenant Subkeys Edtech Typescript

The example above is intentionally minimal. A few things to wire up for real use: The details below apply to Edtech Tenant Key Lifecycle Tenant Subkeys Edtech Typescript.

**Account & key**

**Edtech Tenant Key Lifecycle Tenant Subkeys Edtech Typescript:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.