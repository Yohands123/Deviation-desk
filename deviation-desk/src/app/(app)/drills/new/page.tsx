import Link from "next/link";
import { requireViewer } from "@/incident-room/viewer";
import { ScenarioBuilder } from "./scenario-builder";

export default async function NewScenarioPage() {
  await requireViewer();
  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <Link href="/drills" className="text-sm text-muted hover:text-ink">
        ← Drills
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Describe a drill</h1>
      <p className="mt-1 text-sm text-muted">
        The Scenario Builder turns your idea into a runnable scenario mapped to real objects, checks that its timeline is physically possible, and asks if
        anything is unclear. Nothing runs until you approve the preview.
      </p>
      <div className="mt-6">
        <ScenarioBuilder />
      </div>
    </main>
  );
}
