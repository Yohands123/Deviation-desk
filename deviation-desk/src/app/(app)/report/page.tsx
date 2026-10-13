import { requireViewer } from "@/incident-room/viewer";
import { ReportFlow } from "./report-flow";

export default async function ReportPage() {
  await requireViewer();
  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold">Report a problem</h1>
      <p className="mt-1 text-sm text-muted">
        Describe what happened in plain words. Intake Triage will suggest how to classify it; nothing opens until you confirm.
      </p>
      <p className="mt-3 rounded border border-critical bg-critical-fill p-3 text-sm text-critical-text">
        Fire, injury, chemical exposure or power loss? Follow the site emergency procedure and call your emergency contacts first.
      </p>
      <div className="mt-6">
        <ReportFlow />
      </div>
    </main>
  );
}
