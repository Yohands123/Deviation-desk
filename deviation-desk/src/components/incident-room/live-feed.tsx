import type { FeedItem } from "@/incident-room/types";
import { AiMarker, cx, timeLabel } from "../ui";

export function LiveFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted">Nothing has happened yet.</p>;
  return (
    <ol className="space-y-3" aria-live="polite">
      {items.slice(0, 60).map((item) => (
        <li key={item.id} className={cx("border-l-2 pl-3", item.actorKind === "ai" ? "border-accent" : item.actorKind === "human" ? "border-ink" : "border-line")}>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {item.actorKind === "ai" ? <AiMarker label={item.actor} /> : <span className="font-medium">{item.actor}</span>}
            <time className="font-mono text-muted" dateTime={item.at}>
              {timeLabel(item.at)}
            </time>
          </div>
          <p className="mt-0.5 text-sm">{item.text}</p>
        </li>
      ))}
    </ol>
  );
}
