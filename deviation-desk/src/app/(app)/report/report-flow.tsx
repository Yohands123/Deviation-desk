"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AiMarker, ConfidenceMeter } from "@/components/ui";
import { confirmReport, previewReport, type ReportPreview } from "@/incident-room/actions";
import { actionLabel } from "@/incident-room/view-model";

function PreviewDetails({ preview }: { preview: ReportPreview }) {
  const p = preview.action?.params ?? {};
  const objects = Array.isArray(p.objects) ? (p.objects as Array<{ table: string; code: string }>) : [];
  return (
    <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
      {typeof p.title === "string" && (
        <>
          <dt className="text-muted">Title</dt>
          <dd>{p.title}</dd>
        </>
      )}
      {typeof p.incidentType === "string" && (
        <>
          <dt className="text-muted">Type</dt>
          <dd className="capitalize">{p.incidentType.replace(/_/g, " ")}</dd>
        </>
      )}
      {typeof p.severity === "string" && (
        <>
          <dt className="text-muted">Severity</dt>
          <dd className="capitalize">{p.severity}</dd>
        </>
      )}
      {objects.length > 0 && (
        <>
          <dt className="text-muted">Objects</dt>
          <dd className="font-mono text-[13px]">{objects.map((o) => `${o.code} (${o.table.replace(/_/g, " ")})`).join(", ")}</dd>
        </>
      )}
      {typeof p.incidentCode === "string" && (
        <>
          <dt className="text-muted">Existing incident</dt>
          <dd className="font-mono">{p.incidentCode}</dd>
        </>
      )}
    </dl>
  );
}

export function ReportFlow() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = () =>
    start(async () => {
      setError(null);
      const res = await previewReport(text);
      if (!res.ok) return setError(res.error);
      setPreview(res.preview);
    });

  const confirm = () =>
    start(async () => {
      if (!preview) return;
      const res = await confirmReport(preview.decisionRecordId);
      if (!res.ok) return setError(res.error);
      router.push(`/incidents/${res.code}${res.warning ? "?engine=down" : ""}`);
    });

  const canOpen = preview?.action?.type === "open_incident" || preview?.action?.type === "link_to_incident";
  return (
    <div className="space-y-4">
      <label htmlFor="report" className="block text-sm font-medium">
        What happened?
      </label>
      <textarea
        id="report"
        rows={5}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null);
        }}
        placeholder="For example: Sterility test for batch A-2231 failed, growth in 2 of 20 units."
        className="w-full rounded border border-line bg-panel p-3"
      />
      <button disabled={pending || text.trim().length < 10} onClick={ask} className="rounded bg-ink px-4 py-2 text-sm font-medium text-panel disabled:opacity-40">
        {pending && !preview ? "Intake Triage is reading your report…" : "Check with Intake Triage"}
      </button>

      {preview && (
        <section className="rounded-lg border border-line bg-ai-tint p-4" aria-label="Triage preview">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <AiMarker label={`Intake Triage · ${preview.action ? actionLabel(preview.action.type) : "No incident proposed"}`} />
            <ConfidenceMeter confidence={preview.confidence} score={null} />
          </div>
          <p className="mt-2 text-sm">{preview.summary}</p>
          <PreviewDetails preview={preview} />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted">Reasoning</summary>
            <p className="mt-1 whitespace-pre-wrap">{preview.reasoning}</p>
          </details>
          <div className="mt-4 flex flex-wrap gap-2">
            {canOpen && (
              <button disabled={pending} onClick={confirm} className="rounded border-2 border-ink bg-panel px-4 py-2 text-sm font-semibold disabled:opacity-40">
                {pending ? "Opening…" : preview.action?.type === "open_incident" ? "Open this incident" : "Add to the existing incident"}
              </button>
            )}
            <button onClick={() => setPreview(null)} className="rounded px-4 py-2 text-sm text-muted hover:bg-panel">
              Edit the report
            </button>
          </div>
        </section>
      )}
      {error && (
        <p role="alert" className="text-sm text-critical-text">
          {error}
        </p>
      )}
    </div>
  );
}
