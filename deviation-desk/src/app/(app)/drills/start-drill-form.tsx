"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startDrillAction } from "@/drills/actions";
import type { LibraryScenario } from "@/drills/queries";
import { cx } from "@/components/ui";

export function StartDrillForm({ scenarios }: { scenarios: LibraryScenario[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [difficulty, setDifficulty] = useState(2);
  const [agentsEnabled, setAgentsEnabled] = useState(true);
  const [secondsPerTick, setSecondsPerTick] = useState(20);
  const [seed, setSeed] = useState("");
  const [error, setError] = useState<string | null>(null);
  const chosen = scenarios.find((s) => s.id === scenarioId);

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await startDrillAction({ scenarioId, difficulty, agentsEnabled, secondsPerTick, seed: seed ? Number(seed) : undefined });
      if (!res.ok) return setError(res.error);
      router.push(`/drills/${res.drillRunId}`);
    });

  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Scenario</legend>
        <ul className="grid gap-2 sm:grid-cols-2">
          {scenarios.map((s) => (
            <li key={s.id}>
              <label className={cx("block cursor-pointer rounded border p-3 text-sm", s.id === scenarioId ? "border-accent" : "border-line hover:border-muted")}>
                <input type="radio" name="scenario" value={s.id} checked={s.id === scenarioId} onChange={() => setScenarioId(s.id)} className="sr-only" />
                <span className="font-medium">{s.title}</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Level {s.level} · {s.durationTicks} hours · {s.trigger}
                  {s.source === "builder" ? " · custom" : ""}
                </span>
              </label>
            </li>
          ))}
        </ul>
        {chosen && <p className="mt-2 text-sm text-muted">{chosen.description}</p>}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="text-sm">
          <span className="font-medium">Difficulty: {difficulty}</span>
          <input type="range" min={1} max={5} value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))} className="mt-2 w-full" />
          <span className="text-xs text-muted">How often the saboteurs strike.</span>
        </label>
        <label className="text-sm">
          <span className="font-medium">Seconds per simulated hour</span>
          <input type="number" min={5} max={600} value={secondsPerTick} onChange={(e) => setSecondsPerTick(Number(e.target.value))} className="mt-2 w-full rounded border border-line bg-panel px-2 py-1" />
        </label>
        <label className="text-sm">
          <span className="font-medium">Seed (optional)</span>
          <input inputMode="numeric" value={seed} onChange={(e) => setSeed(e.target.value.replace(/\D/g, ""))} placeholder="Random" className="mt-2 w-full rounded border border-line bg-panel px-2 py-1 font-mono" />
          <span className="text-xs text-muted">Same seed, same drill: use it to replay.</span>
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agentsEnabled} onChange={(e) => setAgentsEnabled(e.target.checked)} className="mt-1" />
        <span>
          <span className="font-medium">AI agents respond</span>
          <span className="block text-xs text-muted">Turn off for a people-only tabletop exercise (no model costs). Empty seats still decide as AI-played seats.</span>
        </span>
      </label>

      <button disabled={pending || !scenarioId} onClick={submit} className="rounded bg-ink px-4 py-2 text-sm font-medium text-panel disabled:opacity-40">
        {pending ? "Setting up the drill world…" : "Start the drill"}
      </button>
      {error && <p role="alert" className="text-sm text-critical-text">{error}</p>}
    </div>
  );
}
