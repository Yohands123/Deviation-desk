import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** Seeds an isolated company and archives its live world afterwards to exclude later AI sweeps. */
export default function globalSetup() {
  const root = join(__dirname, "..");
  const out = execFileSync(
    process.execPath,
    [join(root, "node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", "--env-file-if-exists=.env.local", "scripts/e2e-fixture.ts"],
    { cwd: root, encoding: "utf8" },
  );
  const json = out.trim().split(/\r?\n/).at(-1) ?? "";
  writeFileSync(join(__dirname, ".fixture.json"), json);
  const { worldId } = JSON.parse(json) as { worldId: string };
  return () => {
    execFileSync(
      process.execPath,
      [join(root, "node_modules", "tsx", "dist", "cli.mjs"), "--conditions=react-server", "--env-file-if-exists=.env.local", "scripts/e2e-fixture.ts", "--archive", worldId],
      { cwd: root, stdio: "inherit" },
    );
  };
}
