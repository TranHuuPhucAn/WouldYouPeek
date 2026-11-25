const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)+$/;

/** Scenario IDs include original editorial slugs; other record IDs remain UUIDs. */
export function isScenarioId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 100 &&
    (UUID.test(value) || SLUG.test(value))
  );
}

export function normalizeScenarioId(value: string): string {
  if (!isScenarioId(value)) throw new Error("Invalid scenario identifier.");
  return UUID.test(value) ? value.toLowerCase() : value;
}
