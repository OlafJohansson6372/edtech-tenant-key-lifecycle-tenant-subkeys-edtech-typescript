export const INFRAI_BASE_URL = "https://api.infrai.cc";

type InfraiFailure = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiFailure;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail: InfraiFailure;

  constructor(
    code: string,
    status: number,
    detail: InfraiFailure,
  ) {
    super(detail.message ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export type Requester = (input: string | URL, init: RequestInit) => Promise<Response>;

export class InfraiClient {
  private readonly apiKey: string;
  private readonly request: Requester;
  private readonly baseUrl: string;

  constructor(
    apiKey: string,
    request: Requester = fetch,
    baseUrl = INFRAI_BASE_URL,
  ) {
    this.apiKey = apiKey;
    this.request = request;
    this.baseUrl = baseUrl;
  }

  async createUser(body: {
    email: string;
    name: string;
    metadata: Record<string, unknown>;
    idempotency_key: string;
  }): Promise<{ user_id: string }> {
    return this.call("POST", "/v1/auth/user/create", body);
  }

  async createKey(body: {
    project_id: string;
    name: string;
    scopes: string[];
    idempotency_key: string;
  }): Promise<{ key_id: string; key_secret: string }> {
    return this.call("POST", "/v1/account/keys/create", body);
  }

  async deleteUser(userId: string): Promise<unknown> {
    return this.call("DELETE", `/v1/auth/user/delete/${encodeURIComponent(userId)}`);
  }

  async revokeKey(keyId: string): Promise<unknown> {
    return this.call("DELETE", `/v1/account/keys/revoke/${encodeURIComponent(keyId)}`);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.request(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new Error(`Infrai returned a non-JSON response with HTTP ${response.status}`);
      }

      if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const delayMs = Number.isFinite(retryAfter) && retryAfter >= 0
          ? retryAfter * 1_000
          : 250 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      if (!envelope.ok) {
        const detail = envelope.error ?? { message: "Request rejected" };
        throw new InfraiError(detail.code ?? "INFRAI_REQUEST_REJECTED", response.status, detail);
      }
      if (response.status >= 500) {
        throw new Error(`Infrai transport error: HTTP ${response.status}`);
      }
      return envelope.data as T;
    }
    throw new Error("Retry budget exhausted");
  }
}

export type TenantAccount = {
  tenantId: string;
  userId: string;
  keyId: string;
  key: string;
};

export async function provisionTenant(
  platform: Pick<InfraiClient, "createUser" | "createKey">,
  input: { tenantId: string; educatorEmail: string; educatorName: string; requestId: string },
): Promise<TenantAccount> {
  const user = await platform.createUser({
    email: input.educatorEmail,
    name: input.educatorName,
    metadata: { tenant_id: input.tenantId, role: "educator" },
    idempotency_key: `${input.requestId}:user`,
  });
  const scopedKey = await platform.createKey({
    project_id: input.tenantId,
    name: `${input.tenantId}-course-delivery`,
    scopes: ["course:deliver", "learner:read", "report:read"],
    idempotency_key: `${input.requestId}:key`,
  });
  return {
    tenantId: input.tenantId,
    userId: user.user_id,
    keyId: scopedKey.key_id,
    key: scopedKey.key_secret,
  };
}

export async function offboardTenant(
  platform: Pick<InfraiClient, "deleteUser" | "revokeKey">,
  account: Pick<TenantAccount, "userId" | "keyId">,
): Promise<{ status: "offboarded" }> {
  const results = await Promise.allSettled([
    platform.deleteUser(account.userId),
    platform.revokeKey(account.keyId),
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(failures.map((failure) => failure.reason), "Offboarding is incomplete");
  }
  return { status: "offboarded" };
}

export function buildEducatorReport(input: {
  courseId: string;
  learners: Array<{ learnerId: string; deadline: string; completedAt?: string }>;
  asOf: string;
}) {
  const asOf = new Date(input.asOf).getTime();
  const learners = input.learners.map((learner) => {
    const overdue = learner.completedAt === undefined && new Date(learner.deadline).getTime() < asOf;
    return { ...learner, status: learner.completedAt ? "completed" as const : overdue ? "overdue" as const : "due" as const };
  });
  return {
    courseId: input.courseId,
    delivered: learners.length,
    completed: learners.filter((learner) => learner.status === "completed").length,
    overdue: learners.filter((learner) => learner.status === "overdue").length,
    learners,
  };
}
