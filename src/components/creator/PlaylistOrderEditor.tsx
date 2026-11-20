"use client";
import { useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import type { CreatorPlaylistItem } from "@/contracts/playlist";
export function PlaylistOrderEditor({
  items,
  onMove,
  onRemove,
  onUpdate,
  disabled = false,
}: {
  items: CreatorPlaylistItem[];
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onUpdate: (id: string, version: string) => void;
  disabled?: boolean;
}) {
  const [notice, setNotice] = useState(""),
    focusId = useRef<string | null>(null),
    rows = useRef(new Map<string, HTMLHeadingElement>());
  useLayoutEffect(() => {
    if (focusId.current) {
      if (focusId.current === "picker")
        document.getElementById("playlist-scenario-search")?.focus();
      else rows.current.get(focusId.current)?.focus();
      focusId.current = null;
    }
  }, [items]);
  return (
    <section className="playlist-order-editor">
      <h2>
        Playlist order <span className="quiet-note">{items.length}/20</span>
      </h2>
      <p className="sr-only" role="status" aria-live="polite">
        {notice}
      </p>
      {!items.length && (
        <p className="surface-card creator-empty">
          Add published scenarios to begin your sequence.
        </p>
      )}
      <ol className="playlist-order-list">
        {items.map((item, index) => {
          const id = item.selection.scenarioId,
            title = item.preview?.title ?? "Scenario details load after saving";
          return (
            <li className="surface-card playlist-item" key={id}>
              <span className="playlist-position">
                {String(index + 1).padStart(2, "0")}
              </span>
              <div className="playlist-item-content">
                <h3
                  tabIndex={-1}
                  ref={(element) => {
                    if (element) rows.current.set(id, element);
                    else rows.current.delete(id);
                  }}
                >
                  {title}
                </h3>
                {item.preview && (
                  <p>
                    {item.preview.player.displayName} · {item.preview.map} ·{" "}
                    {item.preview.topic} ·{" "}
                    {item.preview.sourceKind === "youtube"
                      ? "YouTube"
                      : "Uploaded recording"}
                  </p>
                )}
                <p className="quiet-note">
                  Selected version {item.selection.scenarioVersion} ·{" "}
                  <Link href={`/creator/scenarios/${id}`}>
                    Open current scenario draft
                  </Link>
                </p>
                {item.issues.map((issue, i) => (
                  <p className="field-error" key={i}>
                    {issue.message}
                  </p>
                ))}
                {item.currentVersion &&
                  item.currentVersion !== item.selection.scenarioVersion && (
                    <p className="quiet-note">
                      A newer version is available.{" "}
                      <button
                        type="button"
                        disabled={disabled}
                        className="text-button"
                        onClick={() => onUpdate(id, item.currentVersion!)}
                      >
                        Update to latest
                      </button>
                    </p>
                  )}
                <div className="playlist-order-controls">
                  <button
                    type="button"
                    disabled={disabled || index === 0}
                    className="text-button"
                    aria-label={`Move ${title} up`}
                    onClick={() => {
                      focusId.current = id;
                      setNotice(`${title} moved to position ${index}.`);
                      onMove(id, -1);
                    }}
                  >
                    ↑ Move up
                  </button>
                  <button
                    type="button"
                    disabled={disabled || index === items.length - 1}
                    className="text-button"
                    aria-label={`Move ${title} down`}
                    onClick={() => {
                      focusId.current = id;
                      setNotice(`${title} moved to position ${index + 2}.`);
                      onMove(id, 1);
                    }}
                  >
                    ↓ Move down
                  </button>
                  <button
                    type="button"
                    disabled={disabled}
                    className="text-button"
                    aria-label={`Remove ${title}`}
                    onClick={() => {
                      focusId.current =
                        items[index + 1]?.selection.scenarioId ??
                        items[index - 1]?.selection.scenarioId ??
                        "picker";
                      setNotice(`${title} removed.`);
                      onRemove(id);
                    }}
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
