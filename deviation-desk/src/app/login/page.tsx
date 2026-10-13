import { redirect } from "next/navigation";
import { ProductMark } from "@/components/brand";
import { getViewer } from "@/incident-room/viewer";
import { LoginForm } from "./login-form";

// Shown only against a local Supabase, where the seed creates these demo accounts.
const DEMO_ACCOUNTS = [
  ["Elena Duarte", "QA Director", "elena.duarte@helix.example"],
  ["Priya Raman", "Plant Manager", "priya.raman@helix.example"],
  ["Tomás Reyes", "Supply Chain Lead", "tomas.reyes@helix.example"],
  ["Hannah Okafor", "Regulatory Affairs", "hannah.okafor@helix.example"],
  ["Marcus Bell", "Clinical Ops", "marcus.bell@helix.example"],
  ["Daniel Brooks", "Executive", "daniel.brooks@helix.example"],
] as const;

export default async function LoginPage() {
  if (await getViewer()) redirect("/incidents");
  const local = /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-12">
      <div className="mb-8">
        <ProductMark />
      </div>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Incident readiness and response.</p>
      <div className="mt-6 rounded-lg border border-line bg-panel p-5">
        <LoginForm />
      </div>
      {local && (
        <div className="mt-6 rounded-lg border border-line p-4 text-sm">
          <p className="font-medium">Local demo accounts</p>
          <p className="text-muted">
            Password <span className="font-mono">helix-demo</span> for everyone at Helix Biologics.
          </p>
          <ul className="mt-2 space-y-1">
            {DEMO_ACCOUNTS.map(([name, role, email]) => (
              <li key={email}>
                {name} <span className="text-muted">({role})</span> · <span className="font-mono text-xs">{email}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
