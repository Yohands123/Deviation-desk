/**
 * Inngest functions for the first agent chain: one per event, each wrapping its handler so every
 * agent call is a durable, retryable step. After the root cause is challenged, the chain waits for
 * the QA Director's decision and escalates if nobody answers (Layer 4, CLAUDE.md §8).
 */
import "server-only";
import { inngest } from "./client";
import { RootCauseProposed } from "./events";
import { handlers, type Handler, type StepRunner } from "./handlers";

const APPROVAL_TIMEOUT = "2h";

interface StepTools {
  run: (id: string, fn: () => Promise<unknown>) => Promise<unknown>;
}

// Inngest returns step results as JSON; handlers only return plain JSON values from steps.
const stepRunner = (step: StepTools): StepRunner => (id, fn) => step.run(id, fn) as never;

function handlerFunction(event: string, handler: Handler) {
  return inngest.createFunction({ id: event.replace("/", "-"), triggers: [{ event }] }, async ({ event: e, step }) => {
    const emitted = await handler(stepRunner(step), e.data);
    if (emitted.length > 0) await step.sendEvent("emit", emitted);
    return { emitted: emitted.map((x) => x.name) };
  });
}

const rootCauseProposed = inngest.createFunction(
  { id: "root_cause-proposed", triggers: [{ event: "root_cause/proposed" }] },
  async ({ event, step }) => {
    const data = RootCauseProposed.parse(event.data);
    const handler = handlers["root_cause/proposed"];
    if (!handler) throw new Error("No handler for root_cause/proposed");
    const emitted = await handler(stepRunner(step), event.data);
    if (emitted.length > 0) await step.sendEvent("emit", emitted);

    // Pause until the QA Director decides on this exact proposal (ids are uuids from our database).
    const decision = await step.waitForEvent("wait-for-qa-decision", {
      event: "decision/resolved",
      timeout: APPROVAL_TIMEOUT,
      if: `async.data.decisionRecordId == "${data.decisionRecordId}"`,
    });
    if (!decision) {
      await step.sendEvent("escalate", {
        name: "incident/escalated",
        data: { ...data, reason: "QA decision on the root cause timed out" },
      });
      return { status: "escalated" };
    }
    return { status: "resolved" };
  },
);

export const functions = [
  ...Object.entries(handlers)
    .filter(([event]) => event !== "root_cause/proposed")
    .map(([event, handler]) => handlerFunction(event, handler)),
  rootCauseProposed,
];
