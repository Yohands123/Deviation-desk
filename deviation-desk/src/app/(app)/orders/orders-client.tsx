"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { logOrderAction } from "@/orders/actions";

const PRIORITIES = [
  ["routine", "Routine"],
  ["high", "High"],
  ["patient_critical", "Patient-critical"],
] as const;

export function LogOrderForm({ products, destinations }: { products: Array<{ id: string; name: string }>; destinations: Array<{ id: string; name: string; kind: string }> }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [destinationId, setDestinationId] = useState(destinations[0]?.id ?? "");
  const [quantity, setQuantity] = useState("200");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number][0]>("routine");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const submit = () =>
    start(async () => {
      const res = await logOrderAction({ productId, destinationId, quantity, dueAt: new Date(dueAt).toISOString(), priority });
      if (!res.ok) return setMessage({ tone: "error", text: res.error });
      setMessage({ tone: "ok", text: res.warning ?? `Logged ${res.orderCode}. The Order Desk is checking it.` });
      router.refresh();
    });

  const field = "mt-1 w-full rounded border border-line bg-panel px-2 py-1 text-sm";
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <label className="text-sm lg:col-span-2">
        <span className="font-medium">Product</span>
        <select value={productId} onChange={(e) => setProductId(e.target.value)} className={field}>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm lg:col-span-3">
        <span className="font-medium">For</span>
        <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className={field}>
          {destinations.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        <span className="font-medium">Units</span>
        <input inputMode="numeric" value={quantity} onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ""))} className={`${field} font-mono`} />
      </label>
      <label className="text-sm lg:col-span-2">
        <span className="font-medium">Due</span>
        <input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} className={field} />
      </label>
      <label className="text-sm lg:col-span-2">
        <span className="font-medium">Priority</span>
        <select value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={field}>
          {PRIORITIES.map(([v, label]) => (
            <option key={v} value={v}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-5">
        <button disabled={pending || !productId || !destinationId || !dueAt || !quantity} onClick={submit} className="rounded bg-ink px-4 py-2 text-sm font-medium text-panel disabled:opacity-40">
          {pending ? "Logging…" : "Log the order"}
        </button>
        {message && (
          <p role="status" className={message.tone === "error" ? "text-sm text-critical-text" : "text-sm text-muted"}>
            {message.text}
          </p>
        )}
      </div>
    </div>
  );
}
