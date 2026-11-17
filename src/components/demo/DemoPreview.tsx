"use client";
import { useState } from "react";
import Link from "next/link";
import type { ChallengePreview } from "@/contracts/challenge";
import { ScenarioMedia } from "@/components/challenge/ScenarioMedia";
export function DemoPreview({ previews }: { previews: ChallengePreview[] }) {
  const [selected, setSelected] = useState(previews[0]?.id);
  const preview = previews.find((item) => item.id === selected);
  if (!preview) return <p>No demo scenarios are available right now.</p>;
  return (
    <div className="demo-layout">
      <nav className="preview-selector" aria-label="Demo scenarios">
        {previews.map((item, index) => (
          <button
            key={item.id}
            aria-pressed={item.id === selected}
            onClick={() => setSelected(item.id)}
          >
            <span className="mono">0{index + 1}</span>
            <span>
              <small>{item.topic}</small>
              <strong>{item.title}</strong>
            </span>
          </button>
        ))}
      </nav>
      <section>
        <h2 className="demo-title">{preview.title}</h2>
        <ScenarioMedia
          key={preview.id}
          media={preview.setup}
          label="Setup preview"
        />
        <p className="preview-context">{preview.context}</p>
        <div className="preview-callout">
          <div>
            <span className="eyebrow">WHAT WOULD YOU DO NEXT?</span>
            <h3>Make the call in your own session.</h3>
            <p>
              Sign in to choose, see the continuation and keep your progress.
            </p>
          </div>
          <Link
            href="/sign-in?returnTo=%2Fplay"
            className="button button-primary"
          >
            Sign in to play →
          </Link>
        </div>
      </section>
    </div>
  );
}
