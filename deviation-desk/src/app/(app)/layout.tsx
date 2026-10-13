import type { ReactNode } from "react";
import { MainNav, ModeMarker, ThemeScope } from "@/components/app-chrome";
import { ProductMark } from "@/components/brand";
import { signOut } from "@/incident-room/actions";
import { requireViewer } from "@/incident-room/viewer";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await requireViewer();
  return (
    <ThemeScope>
      <header className="border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <ProductMark />
            <span className="hidden text-sm text-muted sm:inline">{viewer.companyName}</span>
            <ModeMarker />
            <MainNav />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span>
              {viewer.name} <span className="text-muted">· {viewer.role}</span>
            </span>
            <form action={signOut}>
              <button className="rounded px-2 py-1 text-muted hover:bg-ground hover:text-ink">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      {children}
    </ThemeScope>
  );
}
