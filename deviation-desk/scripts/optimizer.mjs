// Starts the optimizer service from its virtualenv: npm run optimizer
// One-time setup: cd services/optimizer && python -m venv .venv && .venv/bin/pip install -r requirements.txt
// (on Windows: .venv\Scripts\pip).
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const dir = join(import.meta.dirname, "..", "services", "optimizer");
const python = [join(dir, ".venv", "Scripts", "python.exe"), join(dir, ".venv", "bin", "python")].find(existsSync);
if (!python) {
  console.error("No optimizer virtualenv found. See the setup comment at the top of scripts/optimizer.mjs.");
  process.exit(1);
}
const child = spawn(python, ["-m", "uvicorn", "main:app", "--port", "8001", ...process.argv.slice(2)], {
  cwd: dir,
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code ?? 0));
