import type { ValidationIssue } from "@/contracts/creator";
import type { PlaylistDraftContent } from "@/contracts/playlist";
import { isScenarioId } from "@/lib/scenario-id";

export const PLAYLIST_LIMITS = {
  title: 120,
  description: 1000,
  items: 20,
  displayName: 50,
} as const;
const whitespace =
  /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
const controls = /[\u0000-\u0008\u000e-\u001f\u007f-\u0084\u0086-\u009f]/;
const text = (v: string) => v.replace(whitespace, " ").trim();
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const shape = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  record(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
export function normalizeCreatorDisplayName(value: string): string {
  return text(value);
}
export function validateCreatorDisplayName(value: unknown): ValidationIssue[] {
  return typeof value !== "string" ||
    controls.test(value) ||
    [...text(value)].length < 2 ||
    [...text(value)].length > 50
    ? [
        {
          path: "displayName",
          code: "INVALID_FIELD",
          message:
            "Enter a public name of 2–50 characters without control characters.",
        },
      ]
    : [];
}
export function normalizePlaylistDraft(
  content: PlaylistDraftContent,
): PlaylistDraftContent {
  return {
    title: text(content.title),
    description: content.description.trim(),
    items: content.items.map((item) => ({
      ...item,
      scenarioId: item.scenarioId.toLowerCase(),
    })),
  };
}
export function validatePlaylistDraft(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string, code = "INVALID_FIELD") =>
    issues.push({ path, message, code });
  if (!shape(value, ["title", "description", "items"]))
    return [
      {
        path: "content",
        code: "INVALID_SHAPE",
        message: "Use only the documented playlist fields.",
      },
    ];
  for (const [key, max] of [
    ["title", 120],
    ["description", 1000],
  ] as const)
    if (
      typeof value[key] !== "string" ||
      [...value[key]].length > max ||
      controls.test(value[key])
    )
      issue(
        key,
        `Enter text of at most ${max} characters without control characters.`,
      );
  if (!Array.isArray(value.items) || value.items.length > 20)
    issue("items", "Choose at most 20 scenarios.");
  else {
    const ids = new Set<string>();
    value.items.forEach((item, index) => {
      if (!shape(item, ["scenarioId", "scenarioVersion"])) {
        issue(
          `items.${index}`,
          "Use a scenario and its exact version.",
          "INVALID_SHAPE",
        );
        return;
      }
      if (
        !isScenarioId(item.scenarioId) ||
        ids.has(String(item.scenarioId).toLowerCase())
      )
        issue(`items.${index}.scenarioId`, "Choose each scenario only once.");
      else ids.add(String(item.scenarioId).toLowerCase());
      if (
        typeof item.scenarioVersion !== "string" ||
        !/^[A-Za-z0-9._-]{1,100}$/.test(item.scenarioVersion)
      )
        issue(
          `items.${index}.scenarioVersion`,
          "Choose a published scenario version.",
        );
    });
  }
  return issues;
}
export function validatePlaylistPublishContent(
  value: unknown,
): ValidationIssue[] {
  const issues = validatePlaylistDraft(value);
  if (issues.length) return issues;
  const content = normalizePlaylistDraft(value as PlaylistDraftContent);
  if (!content.title)
    issues.push({
      path: "title",
      code: "REQUIRED",
      message: "Add a title before review.",
    });
  if (!content.items.length)
    issues.push({
      path: "items",
      code: "REQUIRED",
      message: "Choose at least one published scenario.",
    });
  return issues;
}
