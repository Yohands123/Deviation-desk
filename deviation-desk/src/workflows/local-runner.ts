/**
 * Runs the event chain in-process, without the Inngest dev server: each emitted event is handled
 * in order until none are left. Used by the eval harness. Approval waits are not simulated; the
 * chain stops where a human decision is needed.
 */
import type { Emitted } from "./events";
import { handlers, type StepRunner } from "./handlers";

export interface ProcessedEvent extends Emitted {
  handled: boolean;
}

export async function runLocally(first: Emitted, maxEvents = 25): Promise<ProcessedEvent[]> {
  const run: StepRunner = (_id, fn) => fn();
  const queue: Emitted[] = [first];
  const processed: ProcessedEvent[] = [];
  while (queue.length > 0) {
    if (processed.length >= maxEvents) throw new Error(`Event chain exceeded ${maxEvents} events; possible loop.`);
    const event = queue.shift() as Emitted; // non-empty: checked by the loop condition
    const handler = handlers[event.name];
    processed.push({ ...event, handled: Boolean(handler) });
    if (handler) queue.push(...(await handler(run, event.data)));
  }
  return processed;
}
