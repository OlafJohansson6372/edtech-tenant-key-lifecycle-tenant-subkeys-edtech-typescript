import { createServer, type ServerResponse } from "node:http";
import { z } from "zod";
import {
  InfraiClient,
  InfraiError,
  buildEducatorReport,
  offboardTenant,
  provisionTenant,
} from "./tenant_account.js";

const apiKey = process.env.INFRAI_API_KEY;
if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");
const platform = new InfraiClient(apiKey);

const provisionSchema = z.object({
  tenantId: z.string().min(1),
  educatorEmail: z.string().email(),
  educatorName: z.string().min(1),
  requestId: z.string().min(1),
}).strict();

const offboardSchema = z.object({ userId: z.string().min(1), keyId: z.string().min(1) }).strict();
const reportSchema = z.object({
  courseId: z.string().min(1),
  asOf: z.string().datetime(),
  learners: z.array(z.object({
    learnerId: z.string().min(1),
    deadline: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  }).strict()),
}).strict();

function send(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "POST" && request.url === "/tenants/provision") {
      const input = provisionSchema.parse(await readJson(request));
      const account = await provisionTenant(platform, input);
      send(response, 201, {
        ...account,
        notice: "Store the plaintext key now; it cannot be retrieved a second time.",
      });
      return;
    }
    if (request.method === "POST" && request.url === "/tenants/offboard") {
      const input = offboardSchema.parse(await readJson(request));
      send(response, 200, await offboardTenant(platform, input));
      return;
    }
    if (request.method === "POST" && request.url === "/courses/report") {
      const input = reportSchema.parse(await readJson(request));
      send(response, 200, buildEducatorReport(input));
      return;
    }
    send(response, 404, { error: "Route not found" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      send(response, 400, { error: "Invalid request", issues: error.issues });
    } else if (error instanceof InfraiError) {
      send(response, error.status >= 400 && error.status < 500 ? error.status : 502, {
        error: error.code,
        detail: error.detail,
      });
    } else {
      send(response, 502, { error: error instanceof Error ? error.message : "Request failed" });
    }
  }
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Tenant service listening on http://localhost:${port}`));
