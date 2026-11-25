"use client";
import type { AccountUser } from "@/contracts/auth";
import { SessionStart } from "@/components/sessions/SessionStart";
export function ScenarioStart({
  scenarioId,
  viewer,
}: {
  scenarioId: string;
  viewer: AccountUser | null;
}) {
  return (
    <SessionStart
      key={`${viewer?.id ?? "guest"}-${scenarioId}`}
      target={{ kind: "scenario", scenarioId }}
      viewer={viewer}
      returnTo={`/library/${scenarioId}`}
    />
  );
}
