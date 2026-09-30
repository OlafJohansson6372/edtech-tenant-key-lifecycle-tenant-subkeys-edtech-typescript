import assert from "node:assert/strict";
import test from "node:test";
import { buildEducatorReport, offboardTenant, provisionTenant } from "./tenant_account.js";

test("provisioning maps the account key response into the documented tenant account", async () => {
  const account = await provisionTenant({
    async createUser() { return { user_id: "user-7" }; },
    async createKey() { return { key_id: "key-7", key_secret: "secret-7" }; },
  }, {
    tenantId: "tenant-7",
    educatorEmail: "chenhua@changba.com",
    educatorName: "Chen Hua",
    requestId: "request-7",
  });

  assert.deepEqual(account, {
    tenantId: "tenant-7",
    userId: "user-7",
    keyId: "key-7",
    key: "secret-7",
  });
});

test("an unfinished learner past the deadline is visible to the educator", () => {
  const report = buildEducatorReport({
    courseId: "course-typescript-1",
    asOf: "2026-09-29T12:00:00.000Z",
    learners: [
      { learnerId: "learner-1", deadline: "2026-09-28T12:00:00.000Z" },
      { learnerId: "learner-2", deadline: "2026-09-30T12:00:00.000Z" },
      { learnerId: "learner-3", deadline: "2026-09-28T12:00:00.000Z", completedAt: "2026-09-27T09:00:00.000Z" },
    ],
  });
  assert.equal(report.delivered, 3);
  assert.equal(report.completed, 1);
  assert.equal(report.overdue, 1);
  assert.equal(report.learners[0]?.status, "overdue");
});

test("offboarding is complete only after both account records are removed", async () => {
  const calls: string[] = [];
  const result = await offboardTenant({
    async deleteUser(id) { calls.push(`user:${id}`); },
    async revokeKey(id) { calls.push(`key:${id}`); },
  }, { userId: "user-7", keyId: "key-7" });
  assert.deepEqual(calls.sort(), ["key:key-7", "user:user-7"]);
  assert.deepEqual(result, { status: "offboarded" });

  await assert.rejects(() => offboardTenant({
    async deleteUser() {},
    async revokeKey() { throw new Error("rejected"); },
  }, { userId: "user-8", keyId: "key-8" }), /Offboarding is incomplete/);
});
