import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Sql, TransactionSql } from "../src/db/client";
import { inviteUsers, parseInviteArgs, parseInviteCsv, readInviteEnvironment } from "./invite-users";

const { createClient, inviteUserByEmail } = vi.hoisted(() => ({
  createClient: vi.fn(),
  inviteUserByEmail: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient }));

const config = {
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEY: "fake-test-key",
  APP_URL: "https://app.example.test/",
};
const entries = [{ person: "Ada Quinn", email: "ada@example.test" }];
const unlinked = { id: "person-1", name: "Ada Quinn", authUserId: null };

function fakeDatabase(people = [unlinked] as Array<Omit<typeof unlinked, "authUserId"> & { authUserId: string | null }>) {
  const read = vi.fn<(query: TemplateStringsArray, ...values: unknown[]) => Promise<typeof people>>()
    .mockResolvedValue(people);
  const transaction = vi.fn<(query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]>>()
    .mockResolvedValueOnce(people).mockResolvedValueOnce([{ id: "person-1" }]);
  const begin = vi.fn(async (work: (tx: TransactionSql) => Promise<string>) => {
    return work(transaction as unknown as TransactionSql);
  });
  const sql = Object.assign(read, { begin }) as unknown as Sql;
  return { sql, read, begin, transaction };
}

beforeEach(() => {
  vi.clearAllMocks();
  createClient.mockReturnValue({ auth: { admin: { inviteUserByEmail } } });
  inviteUserByEmail.mockResolvedValue({ data: { user: { id: "auth-1" } }, error: null });
});

describe("parseInviteCsv", () => {
  it("reads BOMs, CRLF, whitespace and trailing blank lines", () => {
    expect(parseInviteCsv('\uFEFFperson,email\r\n Ada Quinn , ada@example.test \r\n\r\n')).toEqual(entries);
  });

  it("reads quoted commas, escaped quotes and Unicode names", () => {
    expect(parseInviteCsv('person,email\n"Reyes, Tomás",tomas@example.test\n"Ada ""AQ"" Quinn",ada@example.test')).toEqual([
      { person: "Reyes, Tomás", email: "tomas@example.test" },
      { person: 'Ada "AQ" Quinn', email: "ada@example.test" },
    ]);
  });

  it("preserves whitespace inside quoted names for exact database matching", () => {
    expect(parseInviteCsv('person,email\n" Ada Quinn ",ada@example.test'))
      .toEqual([{ person: " Ada Quinn ", email: "ada@example.test" }]);
  });

  it.each([
    "", "email,person\na@example.test,Ada", "person,email,role\nAda,a@example.test,qa",
    "person,email\n", "person,email\nAda", "person,email\n,a@example.test",
    "person,email\nAda,not-an-email", "person,email\nAda,a@example.test,extra", "person,email\n,",
    'person,email\n"Ada,a@example.test', 'person,email\nAd"a,a@example.test',
    'person,email\n"Ada"oops,a@example.test', 'person,email\n"Ada\nQuinn",a@example.test',
  ])("rejects malformed or empty CSV: %s", (text) => {
    expect(() => parseInviteCsv(text)).toThrow();
  });

  it("rejects duplicate people and case-insensitive duplicate emails", () => {
    expect(() => parseInviteCsv("person,email\nAda,a@example.test\nAda,b@example.test")).toThrow(/repeats/);
    expect(() => parseInviteCsv("person,email\nAda,A@example.test\nBen,a@example.test")).toThrow(/repeats/);
  });
});

describe("CLI preflight", () => {
  it("reads both required options and optional dry run in any order", () => {
    expect(parseInviteArgs(["--dry-run", "--map", "invites.csv", "--company", "Helix Biologics"]))
      .toEqual({ company: "Helix Biologics", map: "invites.csv", dryRun: true });
  });

  it.each([
    [], ["--company", "Helix"], ["--company", "--map", "invites.csv"],
    ["--company", "Helix", "--map", "invites.csv", "--unknown"],
    ["--company", "Helix", "--company", "Other", "--map", "invites.csv"],
    ["--company", "Helix", "--map", "invites.csv", "--dry-run", "--dry-run"],
  ].map((args) => ({ args })))("rejects invalid arguments: $args", ({ args }) => {
    expect(() => parseInviteArgs(args)).toThrow();
  });

  it("requires all environment variables even in dry run, without exposing values", () => {
    expect(() => readInviteEnvironment({ ...config, SUPABASE_SECRET_KEY: "" })).toThrow(/SUPABASE_SECRET_KEY/);
    expect(() => readInviteEnvironment(config)).not.toThrow();
    expect(() => readInviteEnvironment({ ...config, APP_URL: "https://secret:password@app.example.test" }))
      .toThrow("APP_URL must be an HTTP(S) URL without credentials, query or fragment.");
    expect(() => readInviteEnvironment({ ...config, DATABASE_URL: "secret-invalid-url" }))
      .toThrow("DATABASE_URL must be a PostgreSQL connection URL.");
  });

  it.each([
    "http://localhost:54321", "http://localhost", "http://127.0.0.1:54321",
    "http://127.0.0.2", "http://[::1]:54321", "http://0.0.0.0:54321",
    "http://host.docker.internal:54321", "http://supabase.local", "http://localhost.",
    "https://10.0.0.1", "https://192.168.1.10", "https://172.16.0.1",
  ])("refuses local Supabase URL %s", (url) => {
    expect(() => readInviteEnvironment({ ...config, NEXT_PUBLIC_SUPABASE_URL: url })).toThrow(/Local Supabase/);
  });

  it("requires HTTPS for hosted Supabase and valid app redirects", () => {
    expect(() => readInviteEnvironment({ ...config, NEXT_PUBLIC_SUPABASE_URL: "http://example.supabase.co" })).toThrow(/HTTPS/);
    expect(() => readInviteEnvironment({ ...config, APP_URL: "javascript:alert(1)" })).toThrow(/APP_URL/);
  });
});

describe("inviteUsers", () => {
  it("dry runs query the selected world without constructing Auth, fetching or writing", async () => {
    const db = fakeDatabase();
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No network allowed"));
    try {
      expect(await inviteUsers(db.sql, "live-world", entries, config, true))
        .toEqual([{ ...entries[0], status: "would invite" }]);
      expect(db.read.mock.calls[0]?.[1]).toBe("live-world");
      expect(db.begin).not.toHaveBeenCalled();
      expect(createClient).not.toHaveBeenCalled();
      expect(inviteUserByEmail).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });

  it("skips a linked person on both dry and actual runs without constructing Auth", async () => {
    const db = fakeDatabase([{ ...unlinked, authUserId: "existing-auth" }]);
    for (const dryRun of [true, false]) {
      expect(await inviteUsers(db.sql, "live-world", entries, config, dryRun))
        .toEqual([{ ...entries[0], status: "skipped (already linked)" }]);
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(db.begin).not.toHaveBeenCalled();
  });

  it("preflights every name before sending any invite", async () => {
    const db = fakeDatabase();
    await expect(inviteUsers(db.sql, "live-world", [...entries, { person: "Unknown", email: "other@example.test" }], config, false))
      .rejects.toThrow(/Unknown person "Unknown"/);
    expect(createClient).not.toHaveBeenCalled();
    expect(db.begin).not.toHaveBeenCalled();
  });

  it("refuses ambiguous person names", async () => {
    const db = fakeDatabase([unlinked, { ...unlinked, id: "person-2" }]);
    await expect(inviteUsers(db.sql, "live-world", entries, config, true)).rejects.toThrow(/ambiguous/);
  });

  it("invites with the admin options and links only the locked world's person", async () => {
    const db = fakeDatabase();
    expect(await inviteUsers(db.sql, "live-world", entries, config, false))
      .toEqual([{ ...entries[0], status: "invited" }]);
    expect(createClient).toHaveBeenCalledWith(config.NEXT_PUBLIC_SUPABASE_URL, config.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    expect(inviteUserByEmail).toHaveBeenCalledWith("ada@example.test", { redirectTo: "https://app.example.test/login" });
    expect(db.transaction.mock.calls[0]?.slice(1)).toEqual(["live-world", "person-1"]);
    expect(db.transaction.mock.calls[1]?.slice(1)).toEqual(["auth-1", "live-world", "person-1"]);
  });

  it("rechecks idempotency after acquiring the row lock", async () => {
    const db = fakeDatabase();
    db.transaction.mockReset().mockResolvedValueOnce([{ ...unlinked, authUserId: "concurrent-auth" }]);
    expect(await inviteUsers(db.sql, "live-world", entries, config, false))
      .toEqual([{ ...entries[0], status: "skipped (already linked)" }]);
    expect(inviteUserByEmail).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("reports Supabase failures without raw secret-bearing messages or DB writes", async () => {
    const db = fakeDatabase();
    inviteUserByEmail.mockResolvedValue({ data: { user: null }, error: { status: 422, message: "fake-secret-token" } });
    const results = await inviteUsers(db.sql, "live-world", entries, config, false);
    expect(results[0]?.status).toBe("error: Supabase invite failed (HTTP 422); check Auth before retrying");
    expect(JSON.stringify(results)).not.toContain("fake-secret-token");
    expect(db.transaction).toHaveBeenCalledTimes(1);
  });

  it("explains recovery if the invite succeeds but the DB link fails", async () => {
    const db = fakeDatabase();
    db.transaction.mockReset().mockResolvedValueOnce([unlinked]).mockRejectedValueOnce(new Error("secret-database-url"));
    const results = await inviteUsers(db.sql, "live-world", entries, config, false);
    expect(results[0]?.status).toBe("error: invite sent but database link failed; review Supabase Auth before retrying");
    expect(JSON.stringify(results)).not.toContain("secret-database-url");
  });

  it("stops after an error and shows which people were never attempted", async () => {
    const db = fakeDatabase([unlinked, { ...unlinked, id: "person-2", name: "Ben" }]);
    inviteUserByEmail.mockRejectedValue(new Error("fake-secret-token"));
    const results = await inviteUsers(db.sql, "live-world", [...entries, { person: "Ben", email: "ben@example.test" }], config, false);
    expect(results[0]?.status).toMatch(/^error:/);
    expect(results[1]?.status).toBe("not attempted");
    expect(JSON.stringify(results)).not.toContain("fake-secret-token");
    expect(inviteUserByEmail).toHaveBeenCalledTimes(1);
  });
});
