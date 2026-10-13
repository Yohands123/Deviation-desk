/**
 * The outbox: every message a person approved, exactly as approved (CLAUDE.md principle 1: no
 * external message leaves without an approval record).
 *
 * Executors queue messages inside the approval's transaction. Delivery is separate and optional:
 * with OUTBOUND_WEBHOOK_URL set, live-world messages are POSTed there (signed with
 * OUTBOUND_WEBHOOK_SECRET when set), e.g. to an n8n workflow that sends email. Without it they stay
 * "not configured". Messages in drill worlds are recorded and never sent (principle 5).
 */
import { createHmac } from "node:crypto";
import type { Sql, TransactionSql } from "@/db/client";
import { ExecutionFailed } from "@/approvals/execution-failed";

export type Audience = "customer" | "trial_site" | "supplier" | "internal" | "regulator";

export interface Recipient {
  contactId: string;
  name: string;
  organization: string;
  email: string;
}

export interface MessageContext {
  worldId: string;
  companyId: string;
  incidentId: string;
  decisionRecordId: string;
  approvalId: string;
}

/** Finds contacts by name or organization (case-insensitive). Every name must match. */
export async function resolveRecipients(tx: TransactionSql, worldId: string, names: string[], kinds: Audience[]): Promise<Recipient[]> {
  const wanted = names.map((n) => n.trim().toLowerCase());
  const rows = await tx<(Recipient & { kind: Audience })[]>`
    select id as contact_id, name, organization, email, kind from contacts
    where world_id = ${worldId} and kind in ${tx(kinds)}
      and (lower(name) in ${tx(wanted)} or lower(organization) in ${tx(wanted)})
    order by organization, name`;
  const missing = wanted.filter((w) => !rows.some((r) => r.name.toLowerCase() === w || r.organization.toLowerCase() === w));
  if (missing.length > 0) {
    throw new ExecutionFailed(`No ${kinds.join(" or ")} contact on file for: ${missing.join(", ")}. Add the contact or correct the draft.`);
  }
  return rows.map(({ contactId, name, organization, email }) => ({ contactId, name, organization, email }));
}

export interface QueuedMessage {
  actionType: string;
  audience: Audience;
  recipients: Recipient[];
  subject: string;
  body: string;
}

/** Records an approved message. Returns its id and whether it may be delivered. */
export async function queueMessage(tx: TransactionSql, ctx: MessageContext, m: QueuedMessage): Promise<{ id: string; status: "ready" | "drill" }> {
  const [world] = await tx<{ kind: string }[]>`select kind from worlds where id = ${ctx.worldId}`;
  const status = world?.kind === "live" ? "ready" : "drill";
  const [row] = await tx<{ id: string }[]>`
    insert into outbound_messages ${tx({
      ...ctx,
      actionType: m.actionType,
      audience: m.audience,
      recipients: tx.json(m.recipients as unknown as Parameters<typeof tx.json>[0]),
      subject: m.subject,
      body: m.body,
      status,
    })}
    returning id`;
  if (!row) throw new Error("Failed to queue message");
  return { id: row.id, status };
}

/** HMAC-SHA256 of the request body, so the receiver can check the message came from us. */
export function signPayload(body: string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export const MAX_DELIVERY_ATTEMPTS = 5;

export interface DeliveryOptions {
  url?: string;
  secret?: string;
  fetchImpl?: typeof fetch;
}

export type DeliveryResult = "sent" | "not_configured" | "skipped" | "failed" | "retry";

/**
 * Delivers one ready message to the webhook. "retry" means the attempt failed and the caller should
 * try again later; after MAX_DELIVERY_ATTEMPTS the message is marked failed.
 */
export async function deliverMessage(sql: Sql, worldId: string, messageId: string, options: DeliveryOptions = {}): Promise<DeliveryResult> {
  const url = options.url ?? process.env.OUTBOUND_WEBHOOK_URL;
  const secret = options.secret ?? process.env.OUTBOUND_WEBHOOK_SECRET;
  const [m] = await sql<
    { id: string; status: string; worldKind: string; attempts: number; incidentCode: string; actionType: string; audience: string; recipients: Recipient[]; subject: string; body: string; createdAt: Date }[]
  >`
    select m.id, m.status, w.kind as world_kind, m.attempts, i.code as incident_code, m.action_type, m.audience, m.recipients, m.subject, m.body, m.created_at
    from outbound_messages m
    join worlds w on w.id = m.world_id
    join incidents i on i.world_id = m.world_id and i.id = m.incident_id
    where m.world_id = ${worldId} and m.id = ${messageId}`;
  // Only live, ready messages leave. A drill message is never sent, whatever its status says.
  if (!m || m.status !== "ready" || m.worldKind !== "live") return "skipped";
  if (!url) {
    await sql`update outbound_messages set status = 'not_configured' where world_id = ${worldId} and id = ${messageId}`;
    return "not_configured";
  }

  const body = JSON.stringify({
    id: m.id,
    incident: m.incidentCode,
    actionType: m.actionType,
    audience: m.audience,
    recipients: m.recipients.map(({ name, organization, email }) => ({ name, organization, email })),
    subject: m.subject,
    body: m.body,
    approvedAt: m.createdAt,
  });
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret) headers["x-deviation-desk-signature"] = signPayload(body, secret);

  let error: string | null = null;
  try {
    const res = await (options.fetchImpl ?? fetch)(url, { method: "POST", headers, body, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) error = `Webhook answered ${res.status}`;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error === null) {
    await sql`update outbound_messages set status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = null where world_id = ${worldId} and id = ${messageId}`;
    return "sent";
  }
  const attempts = m.attempts + 1;
  const final = attempts >= MAX_DELIVERY_ATTEMPTS;
  await sql`
    update outbound_messages set attempts = ${attempts}, last_error = ${error.slice(0, 500)}, status = ${final ? "failed" : "ready"}
    where world_id = ${worldId} and id = ${messageId}`;
  return final ? "failed" : "retry";
}
