"use client";
/**
 * Mode-aware chrome: drill pages use the drill theme and a DRILL badge; everything else is live and
 * carries the persistent LIVE marker (trust rule 6).
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx, LiveMarker } from "./ui";

export function DrillBadge() {
  return (
    <span className="inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-wider" style={{ background: "#2a2340", color: "#cfc4ff" }}>
      DRILL
    </span>
  );
}

const isDrill = (path: string) => path === "/drills" || path.startsWith("/drills/");

export function ThemeScope({ children }: { children: ReactNode }) {
  const path = usePathname();
  return <div className={cx("min-h-screen", isDrill(path) && "theme-drill")}>{children}</div>;
}

export function ModeMarker() {
  return isDrill(usePathname()) ? <DrillBadge /> : <LiveMarker />;
}

export function MainNav() {
  const path = usePathname();
  const link = (href: string, label: string, active: boolean) => (
    <Link href={href} aria-current={active ? "page" : undefined} className={cx("rounded px-2 py-1 text-sm", active ? "bg-ground font-medium text-ink" : "text-muted hover:text-ink")}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Main" className="flex items-center gap-1">
      {link("/incidents", "Incidents", path.startsWith("/incidents") || path === "/report")}
      {link("/drills", "Drills", isDrill(path))}
    </nav>
  );
}
