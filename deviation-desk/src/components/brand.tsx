import Link from "next/link";

/** Product mark: a desk edge with a deviation tick. Original artwork. */
export function ProductMark() {
  return (
    <Link href="/incidents" className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <svg aria-hidden viewBox="0 0 24 24" className="size-6">
        <rect x="2" y="14" width="20" height="3" rx="1" fill="var(--color-ink)" />
        <path d="M5 11 L10 11 L12 6 L14 11 L19 11" fill="none" stroke="var(--color-accent)" strokeWidth="2" strokeLinejoin="round" />
      </svg>
      Deviation Desk
    </Link>
  );
}
