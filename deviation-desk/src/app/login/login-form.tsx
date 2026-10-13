"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signIn } from "@/incident-room/actions";

export function LoginForm() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await signIn(email, password);
          if (!res.ok) return setError(res.error);
          router.push("/incidents");
          router.refresh();
        });
      }}
    >
      <div>
        <label htmlFor="email" className="block text-sm font-medium">
          Email
        </label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded border border-line px-3 py-2" />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm font-medium">
          Password
        </label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded border border-line px-3 py-2" />
      </div>
      {error && (
        <p role="alert" className="text-sm text-critical-text">
          {error}
        </p>
      )}
      <button disabled={pending} className="w-full rounded bg-ink px-3 py-2 font-medium text-panel disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
