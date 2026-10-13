import "server-only";
import { inngest } from "./client";
import type { Emitted } from "./events";

/**
 * Sends an event to the workflow engine. Returns false (and logs) when the engine is unreachable,
 * so a person's recorded decision is never lost because Inngest is down; callers tell the person
 * the follow-up work has not started.
 */
export async function emit(event: Emitted): Promise<boolean> {
  try {
    await inngest.send(event);
    return true;
  } catch (err) {
    console.error(`[workflows] could not send ${event.name}; is the Inngest dev server running (npm run inngest)?`, err);
    return false;
  }
}
