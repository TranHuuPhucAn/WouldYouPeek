export type TimestampResult =
  { value: number | null; error: null } | { value: null; error: string };
export function parseTimestampInput(text: string): TimestampResult {
  const value = text.trim();
  if (!value) return { value: null, error: null };
  if (!/^\d+(?::\d{1,2}){0,2}(?:\.\d{1,3})?$/.test(value))
    return {
      value: null,
      error: "Use seconds, mm:ss or hh:mm:ss, with up to three decimal places.",
    };
  const parts = value.split(":").map(Number);
  if (parts.slice(1).some((part) => part >= 60))
    return {
      value: null,
      error: "Minutes and seconds after a colon must be below 60.",
    };
  const seconds =
    Math.round(parts.reduce((total, part) => total * 60 + part, 0) * 1000) /
    1000;
  if (!Number.isFinite(seconds) || seconds > 43200)
    return { value: null, error: "Choose a timestamp between 0 and 12 hours." };
  return { value: seconds, error: null };
}
export function formatTimestampInput(seconds: number | null): string {
  if (seconds === null) return "";
  const milliseconds = Math.round(seconds * 1000);
  const whole = Math.floor(milliseconds / 1000);
  const fraction = String(milliseconds % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}
export function getTimingSummary(media: {
  startSeconds: number | null;
  decisionSeconds: number | null;
  endSeconds: number | null;
}) {
  return {
    setup:
      media.startSeconds === null || media.decisionSeconds === null
        ? null
        : Math.round((media.decisionSeconds - media.startSeconds) * 1000) /
          1000,
    continuation:
      media.decisionSeconds === null || media.endSeconds === null
        ? null
        : Math.round((media.endSeconds - media.decisionSeconds) * 1000) / 1000,
  };
}
