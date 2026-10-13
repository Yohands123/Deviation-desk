import { describe, expect, it } from "vitest";
import { CouncilVoteParams, MessageParams } from "./action-params";

describe("action params", () => {
  it("accepts a council vote whose conflict id came back as a number", () => {
    expect(CouncilVoteParams.parse({ conflictId: 541, favors: "other_seat", position: "Hold it." }).conflictId).toBe("541");
    expect(CouncilVoteParams.safeParse({ conflictId: "abc", favors: "other_seat", position: "x" }).success).toBe(false);
  });

  it("requires at least one recipient for a message", () => {
    expect(MessageParams.safeParse({ to: [], subject: "s", message: "m" }).success).toBe(false);
  });
});
