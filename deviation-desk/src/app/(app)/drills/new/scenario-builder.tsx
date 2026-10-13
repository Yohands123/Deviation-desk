"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AiMarker, Mono } from "@/components/ui";
import { approveScenario, previewScenario, type ScenarioPreview } from "@/drills/actions";

function ScenarioDetails({ preview }: { preview: ScenarioPreview }) {
  const s = preview.scenario;
  if (!s) return null;
  return (
    <div className="mt-3 space-y-3 text-sm">
      <p className="text-base font-semibold">{s.title}</p>
      <p>{s.description}</p>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
        <dt className="text-muted">Starts with</dt>
        <dd>
          {s.trigger.type.replace(/_/g, " ")} on <Mono>{s.trigger.target.code}</Mono>
        </dd>
        <dt className="text-muted">Length</dt>
        <dd>
          {s.durationTicks} simulated hours · level {s.level}
        </dd>
        <dt className="text-muted">Spread</dt>
        <dd>{s.spread.mode === "spreader" ? `Spreads through ${s.spread.edgeTypes.join(", ").replace(/_/g, " ")} (${Math.round(s.spread.perTickProbability * 100)}% per hour)` : "Stays local"}</dd>
        <dt className="text-muted">Contain within</dt>
        <dd>
          {s.success.containWithinTicks} hours{s.success.mustProtect.length > 0 && <> · protect <Mono>{s.success.mustProtect.map((m) => m.code).join(", ")}</Mono></>}
        </dd>
      </dl>
      {s.twists.length > 0 && (
        <div>
          <p className="text-muted">Twists</p>
          <ul className="list-disc pl-5">
            {s.twists.map((t) => (
              <li key={`${t.atTick}-${t.description}`}>
                Hour {t.atTick}: {t.description}
              </li>
            ))}
          </ul>
        </div>
      )}
      {preview.hiddenTruth && (
        <div className="rounded border border-auditor bg-auditor-bg p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-auditor">Hidden truth · only you see this</p>
          <p className="mt-1">{preview.hiddenTruth.rootCause}</p>
          <p className="mt-1 text-xs text-muted">
            Cause object <Mono>{preview.hiddenTruth.causeObject.code}</Mono> · accepted answers: {preview.hiddenTruth.acceptableAnswers.join("; ")}
          </p>
        </div>
      )}
    </div>
  );
}

export function ScenarioBuilder() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ScenarioPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = () =>
    start(async () => {
      setError(null);
      const res = await previewScenario(text);
      if (!res.ok) return setError(res.error);
      setPreview(res.preview);
    });

  const approve = () =>
    start(async () => {
      if (!preview) return;
      const res = await approveScenario(preview.decisionRecordId);
      if (!res.ok) return setError(res.error);
      router.push("/drills");
    });

  const ready = preview?.scenario && preview.problems.length === 0;
  return (
    <div className="space-y-4">
      <label htmlFor="drill-idea" className="block text-sm font-medium">
        What should the team face?
      </label>
      <textarea
        id="drill-idea"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        placeholder="For example: a refrigerated truck to trial site 104 loses cooling overnight while the QA Director is unreachable."
        className="w-full rounded border border-line bg-panel p-3"
      />
      <button disabled={pending || text.trim().length < 15} onClick={ask} className="rounded bg-ink px-4 py-2 text-sm font-medium text-panel disabled:opacity-40">
        {pending && !preview ? "The Scenario Builder is drafting (about a minute)…" : "Draft the scenario"}
      </button>

      {preview && (
        <section className="rounded-lg border border-line bg-ai-tint p-4" aria-label="Scenario preview">
          <AiMarker label={`Scenario Builder · ${preview.kind === "question" ? "Question for you" : "Preview"}`} />
          <p className="mt-2 text-sm">{preview.summary}</p>
          <ScenarioDetails preview={preview} />
          {preview.problems.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-sm text-critical-text">
              {preview.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {ready && (
              <button disabled={pending} onClick={approve} className="rounded border-2 border-ink bg-panel px-4 py-2 text-sm font-semibold disabled:opacity-40">
                {pending ? "Saving…" : "Approve and add to the library"}
              </button>
            )}
            <button onClick={() => setPreview(null)} className="rounded px-4 py-2 text-sm text-muted hover:bg-panel">
              {preview.kind === "question" ? "Answer in the description and redraft" : "Edit the description"}
            </button>
          </div>
        </section>
      )}
      {error && <p role="alert" className="text-sm text-critical-text">{error}</p>}
    </div>
  );
}
