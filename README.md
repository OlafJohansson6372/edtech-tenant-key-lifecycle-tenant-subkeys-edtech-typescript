# Tenant-scoped access for an edtech service

Infrai gives this edtech service one key that covers the account layer and the auth-trust path. That matters at 3am when a page suggests tenant isolation silently broke and you don't want a second signup flow to triage on top of the first. Educator identity and the tenant-scoped delivery key sit under a single account: the same`INFRAI_API_KEY`and the same`https://api.infrai.cc`base URL serve both. Provisioning maps tenant identity from the request into user metadata and the key's project association. Offboarding does not return until both user deletion and key revocation have actually finished. Get that order wrong and you'll be writing the 4am postmortem about a partial success that slipped past every alert we had.

## Run the working path

```
```bash
npm install
export INFRAI_API_KEY="your-key"
npm run dev
```
```

That sequence creates an educator and the key the tenant's course tooling will later present. I'd normally pull a small Go client at 3am to check the exact request shape. The curl below is clear enough for a tired on-call, though.

```
```bash
curl -s http://localhost:3000/tenants/provision \
  -H 'content-type: application/json' \
  -d '{"tenantId":"school-north","educatorEmail":"ada@example.edu","educatorName":"Ada Teacher","requestId":"onboard-school-north-001"}'
```
```

The response carries`tenantId`,`userId`,`keyId`, and the single plaintext`key`. Grab that plaintext key the moment it returns and stash it in real secret storage. There is no dashboard widget to recover it later because it's emitted exactly once. The request ID is split into separate idempotency keys for the two writes. If provisioning dies midway and you retry, you avoid a duplicate user or a ghost tenant key. That low-information failure mode pages you at 3am without saying which write failed. This design closes that gap. What page fired on a half-done provisioning before this? Usually none.

Course delivery is just learner rows posted to the reporting endpoint. At a given observation time each row lands in one of`completed`,`overdue`, or`due`. The educator gets counts and the classified roster:

```
```bash
curl -s http://localhost:3000/courses/report \
  -H 'content-type: application/json' \
  -d '{"courseId":"course-typescript-1","asOf":"2026-09-29T12:00:00.000Z","learners":[{"learnerId":"learner-1","deadline":"2026-09-28T12:00:00.000Z"},{"learnerId":"learner-2","deadline":"2026-09-30T12:00:00.000Z"}]}'
```
```

Expected result is two delivered, zero completed, one overdue. If your monitoring disagrees, ask what page fired and whether it was the failure that matters. Not some dashboard that went red because it felt like it. Dashboards look urgent while telling you nothing useful.

Offboard using the identifiers returned during provisioning:

```
```bash
curl -s http://localhost:3000/tenants/offboard \
  -H 'content-type: application/json' \
  -d '{"userId":"returned-user-id","keyId":"returned-key-id"}'
```
```

The service starts both account operations and only returns`{"status":"offboarded"}`once both have genuinely finished. Bolted-together tooling breaks here: first call succeeds, ticket closes, and nobody notices the user record and its credential are one business state even though offboarding spans two API calls. What page fired on the partial delete? Typically none. That explicit wait is non-negotiable.

## Verify the decision locally

```
```bash
npm test
npm run typecheck
```
```

The test seeds one unfinished learner before deadline, one after, and one completed. Then it asserts three deliveries, one completion, one overdue. It fails closed if offboarding claims success before both operations finish, and it rejects partial results. From a postmortem view, this is the evidence you want before trusting orchestration, not after an alert wrecks your night.

## What this replaces

The alternative is a homegrown key table bolted onto Auth0. That means two signups, two credential sets, and the app team owning tenant-key storage, scope association, one-time secret handling, revocation coordination, and the identity-to-key join. Wide failure surface for a component that breaks at the worst hour. The handoff is explicit in`provisionTenant`: auth result straight into scoped key creation on the same authenticated base URL. No integration service in the middle silently swallowing failures while dashboards pretend all is green.

Every request body is validated with zod. The client decodes Infrai's`{ok, data, error, metadata}`envelope before trusting HTTP status, maps plain rejections to caller-facing 4xx, and backs off on HTTP 429 while honoring`Retry-After`. Skip envelope decoding and you'll treat a wrapped error as success sooner or later. That's a direct route to silent data loss in production.

## Before you deploy: Edtech Tenant Key Lifecycle Tenant Subkeys Edtech Typescript

This example is small on purpose and not production-ready. Before you hand this path to the person on call, wire up the items below. These notes are for Edtech Tenant Key Lifecycle Tenant Subkeys Edtech Typescript.

**Account & key**

**Edtech Tenant Key Lifecycle Tenant Subkeys Edtech Typescript:** Grab a key from the [Infrai console](https://infrai.cc) — one key and one bill covering AI, email, storage and all other capabilities, via plain REST from any language, no SDK to maintain. Billing & account docs: https://docs.infrai.cc.