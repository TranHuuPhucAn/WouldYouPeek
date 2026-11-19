import type {
  CreatorDraftContent,
  UploadedCreatorSource,
  ValidationIssue,
} from "@/contracts/creator";

export const CREATOR_LIMITS = {
  requestBytes: 65_536,
  title: 120,
  topic: 80,
  optionLabel: 160,
  shortText: 300,
  prose: 2_000,
  longProse: 4_000,
  sourceUrl: 2_048,
  listItems: 10,
  options: 5,
  sourceSeconds: 43_200,
  setupMinSeconds: 2,
  setupMaxSeconds: 120,
  revealMinSeconds: 1,
  revealMaxSeconds: 120,
} as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const rootKeys = [
  "title",
  "topic",
  "context",
  "question",
  "source",
  "media",
  "knownFacts",
  "unknowns",
  "options",
  "observedAction",
  "analysis",
  "takeaway",
  "outcomeText",
];
const sourceKeys = [
  "url",
  "title",
  "uploader",
  "player",
  "map",
  "agent",
  "score",
  "matchType",
  "round",
  "side",
  "publishedDate",
  "dateNote",
];
const mediaKeys = [
  "startSeconds",
  "decisionSeconds",
  "endSeconds",
  "setupAlt",
  "decisionAlt",
  "revealAlt",
];
const optionKeys = [
  "id",
  "label",
  "assessment",
  "explanation",
  "acceptableWhen",
  "risks",
];
const record = (v: unknown): v is Record<string, unknown> =>
  Boolean(v) && typeof v === "object" && !Array.isArray(v);

export function createEmptyDraft(): CreatorDraftContent {
  return {
    title: "",
    topic: "",
    context: "",
    question: "",
    source: {
      url: "",
      title: "",
      uploader: "",
      player: "",
      map: "",
      agent: "",
      score: "",
      matchType: null,
      round: null,
      side: null,
      publishedDate: "",
      dateNote: "",
    },
    media: {
      startSeconds: null,
      decisionSeconds: null,
      endSeconds: null,
      setupAlt: "",
      decisionAlt: "",
      revealAlt: "",
    },
    knownFacts: [],
    unknowns: [],
    options: [],
    observedAction: { optionId: null, description: "" },
    analysis: { author: "creator", rationale: "", limitations: [] },
    takeaway: "",
    outcomeText: "",
  };
}

export function parseYouTubeSource(
  value: string,
): { videoId: string; url: string } | null {
  try {
    const raw = value.trim();
    if (
      !/^https:\/\/(?:(?:youtube\.com|www\.youtube\.com|m\.youtube\.com)\/watch\?|youtu\.be\/[A-Za-z0-9_-]{11}(?:[?#]|$))/.test(
        raw,
      ) ||
      /\s/.test(raw)
    )
      return null;
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        url.hostname,
      )
    )
      return null;
    const ids = url.searchParams.getAll("v");
    const literalIds = url.search
      .slice(1)
      .split("&")
      .filter((part) => part.startsWith("v="))
      .map((part) => part.slice(2));
    if (
      ids.length !== literalIds.length ||
      ids.some((id, i) => id !== literalIds[i])
    )
      return null;
    let videoId: string;
    if (url.hostname === "youtu.be") {
      videoId = url.pathname.slice(1);
      if (ids.length > 1 || (ids.length === 1 && ids[0] !== videoId))
        return null;
    } else {
      if (url.pathname !== "/watch" || ids.length !== 1) return null;
      videoId = ids[0];
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
  } catch {
    return null;
  }
}

export function normalizeDraftContent(
  content: CreatorDraftContent,
): CreatorDraftContent {
  const trim = (v: unknown): unknown =>
    typeof v === "string"
      ? v.trim()
      : Array.isArray(v)
        ? v.map(trim).filter((x) => x !== "")
        : record(v)
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)]))
          : v;
  const normalized = trim(content) as CreatorDraftContent;
  if (normalized.source.kind !== "uploaded") {
    const source = parseYouTubeSource(normalized.source.url);
    if (source) normalized.source.url = source.url;
  }
  return normalized;
}

export function validateDraftContent(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const issue = (path: string, message: string, code = "INVALID_FIELD") => {
    if (issues.length < 100) issues.push({ path, code, message });
  };
  const shape = (
    v: unknown,
    keys: string[],
    path: string,
  ): v is Record<string, unknown> => {
    if (
      !record(v) ||
      Object.keys(v).length !== keys.length ||
      !keys.every((k) => Object.hasOwn(v, k))
    ) {
      issue(path, "Use only the documented fields.", "INVALID_SHAPE");
      return false;
    }
    return true;
  };
  const text = (v: unknown, max: number, path: string) => {
    if (typeof v !== "string" || Array.from(v).length > max)
      issue(path, `Enter text of at most ${max} characters.`);
  };
  const list = (v: unknown, path: string) => {
    if (!Array.isArray(v) || v.length > 10) {
      issue(path, "Use at most ten text entries.");
      return;
    }
    v.forEach((x, i) => text(x, 300, `${path}.${i}`));
  };
  if (!shape(value, rootKeys, "content")) return issues;
  for (const [key, max] of Object.entries({
    title: 120,
    topic: 80,
    context: 4000,
    question: 2000,
    takeaway: 2000,
    outcomeText: 2000,
  }))
    text(value[key], max, key);
  list(value.knownFacts, "knownFacts");
  list(value.unknowns, "unknowns");
  const uploaded = record(value.source) && value.source.kind === "uploaded";
  const allowedSourceKeys = uploaded
    ? [
        ...sourceKeys.filter((key) => key !== "url"),
        "kind",
        "assetId",
        "creditUrl",
      ]
    : sourceKeys;
  if (shape(value.source, allowedSourceKeys, "source")) {
    const s = value.source;
    for (const key of [
      "title",
      "uploader",
      "player",
      "map",
      "agent",
      "score",
      "publishedDate",
      "dateNote",
    ])
      text(s[key], 300, `source.${key}`);
    if (uploaded) {
      if (
        s.assetId !== null &&
        (typeof s.assetId !== "string" || !UUID.test(s.assetId))
      )
        issue("source.assetId", "Choose an uploaded video.");
      text(s.creditUrl, 2048, "source.creditUrl");
      if (
        typeof s.creditUrl === "string" &&
        s.creditUrl.trim() &&
        !isSafeCreditUrl(s.creditUrl)
      )
        issue(
          "source.creditUrl",
          "Use an HTTPS source credit link or leave it empty.",
        );
    } else text(s.url, 2048, "source.url");
    if (
      s.matchType !== null &&
      s.matchType !== "ranked" &&
      s.matchType !== "tournament"
    )
      issue("source.matchType", "Choose ranked or tournament.");
    if (s.side !== null && s.side !== "attack" && s.side !== "defense")
      issue("source.side", "Choose attack or defense.");
    if (
      s.round !== null &&
      (typeof s.round !== "number" ||
        !Number.isInteger(s.round) ||
        s.round < 1 ||
        s.round > 100)
    )
      issue("source.round", "Use a round from 1 to 100.");
  }
  if (shape(value.media, mediaKeys, "media")) {
    for (const key of ["setupAlt", "decisionAlt", "revealAlt"])
      text(value.media[key], 300, `media.${key}`);
    for (const key of ["startSeconds", "decisionSeconds", "endSeconds"]) {
      const n = value.media[key];
      if (
        n !== null &&
        (typeof n !== "number" ||
          !Number.isFinite(n) ||
          n < 0 ||
          n > 43_200 ||
          Number(n.toFixed(3)) !== n)
      )
        issue(
          `media.${key}`,
          "Use seconds from 0 to 43200, with at most three decimal places.",
        );
    }
  }
  if (!Array.isArray(value.options) || value.options.length > 5)
    issue("options", "Use at most five choices.");
  else {
    const ids = new Set<string>();
    value.options.forEach((option, index) => {
      const path = `options.${index}`;
      if (!shape(option, optionKeys, path)) return;
      if (
        typeof option.id !== "string" ||
        !UUID.test(option.id) ||
        ids.has(option.id.toLowerCase())
      )
        issue(`${path}.id`, "Each choice needs a unique UUID.");
      else ids.add(option.id.toLowerCase());
      text(option.label, 160, `${path}.label`);
      text(option.explanation, 4000, `${path}.explanation`);
      if (
        option.assessment !== null &&
        (typeof option.assessment !== "string" ||
          !["recommended", "reasonable", "risky"].includes(option.assessment))
      )
        issue(`${path}.assessment`, "Choose a supported assessment.");
      list(option.acceptableWhen, `${path}.acceptableWhen`);
      list(option.risks, `${path}.risks`);
    });
  }
  if (
    shape(value.observedAction, ["optionId", "description"], "observedAction")
  ) {
    if (
      value.observedAction.optionId !== null &&
      (typeof value.observedAction.optionId !== "string" ||
        !UUID.test(value.observedAction.optionId))
    )
      issue("observedAction.optionId", "Choose an option identifier.");
    text(value.observedAction.description, 2000, "observedAction.description");
  }
  if (
    shape(value.analysis, ["author", "rationale", "limitations"], "analysis")
  ) {
    if (
      value.analysis.author !== "creator" &&
      value.analysis.author !== "ai-assisted"
    )
      issue(
        "analysis.author",
        "Declare creator-written or AI-assisted analysis.",
      );
    text(value.analysis.rationale, 4000, "analysis.rationale");
    list(value.analysis.limitations, "analysis.limitations");
  }
  return issues;
}

export function validatePublishContent(value: unknown): ValidationIssue[] {
  const issues = validateDraftContent(value);
  if (issues.length) return issues;
  const content = value as CreatorDraftContent;
  const required = (text: string | number | null, path: string) => {
    if (text === null || (typeof text === "string" && !text.trim()))
      issues.push({
        path,
        code: "REQUIRED",
        message: "Complete this field before review.",
      });
  };
  for (const key of [
    "title",
    "topic",
    "context",
    "question",
    "takeaway",
    "outcomeText",
  ] as const)
    required(content[key], key);
  if (!content.knownFacts.some((fact) => fact.trim()))
    issues.push({
      path: "knownFacts",
      code: "REQUIRED",
      message: "Include at least one player-visible fact.",
    });
  for (const key of [
    "title",
    "uploader",
    "player",
    "map",
    "agent",
    "score",
    "matchType",
    "round",
    "side",
  ] as const)
    required(content.source[key], `source.${key}`);
  if (content.source.kind === "uploaded")
    required(content.source.assetId, "source.assetId");
  else if (!parseYouTubeSource(content.source.url))
    issues.push({
      path: "source.url",
      code: "YOUTUBE_SOURCE",
      message: "Use a supported HTTPS YouTube watch or share link.",
    });
  if (!/^\d{1,2}[-:]\d{1,2}$/.test(content.source.score.trim()))
    issues.push({
      path: "source.score",
      code: "SCORE",
      message: "Use a round score such as 5-6.",
    });
  const date = content.source.publishedDate;
  if (
    date &&
    (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    issues.push({
      path: "source.publishedDate",
      code: "DATE",
      message: "Use a valid YYYY-MM-DD date or leave it empty.",
    });
  for (const key of [
    "startSeconds",
    "decisionSeconds",
    "endSeconds",
    "setupAlt",
    "decisionAlt",
    "revealAlt",
  ] as const)
    required(content.media[key], `media.${key}`);
  const {
    startSeconds: start,
    decisionSeconds: decision,
    endSeconds: end,
  } = content.media;
  if (start !== null && decision !== null && end !== null) {
    if (decision - start < 2 || decision - start > 120)
      issues.push({
        path: "media.decisionSeconds",
        code: "SETUP_DURATION",
        message: "Setup must last between 2 and 120 seconds.",
      });
    if (end - decision < 1 || end - decision > 120)
      issues.push({
        path: "media.endSeconds",
        code: "CONTINUATION_DURATION",
        message: "Continuation must last between 1 and 120 seconds.",
      });
  }
  if (content.options.length < 2)
    issues.push({
      path: "options",
      code: "OPTIONS",
      message: "Provide two to five choices.",
    });
  content.options.forEach((option, i) => {
    required(option.label, `options.${i}.label`);
    required(option.assessment, `options.${i}.assessment`);
    required(option.explanation, `options.${i}.explanation`);
  });
  if (
    !content.observedAction.optionId ||
    !content.options.some((o) => o.id === content.observedAction.optionId)
  )
    issues.push({
      path: "observedAction.optionId",
      code: "OBSERVED_OPTION",
      message: "Select the choice corresponding to the pro's action.",
    });
  required(content.observedAction.description, "observedAction.description");
  required(content.analysis.rationale, "analysis.rationale");
  return issues.slice(0, 100);
}

export function getDraftSourceKind(
  source: CreatorDraftContent["source"],
): "youtube" | "uploaded" {
  return source.kind === "uploaded" ? "uploaded" : "youtube";
}
export function createUploadedSource(
  assetId: string | null = null,
): UploadedCreatorSource {
  const { url: _url, ...attribution } = createEmptyDraft().source as Extract<
    CreatorDraftContent["source"],
    { url: string }
  >;
  return { ...attribution, kind: "uploaded", assetId, creditUrl: "" };
}
export function isSafeCreditUrl(raw: string): boolean {
  try {
    const value = new URL(raw);
    return (
      raw === raw.trim() &&
      value.protocol === "https:" &&
      !!value.hostname &&
      !value.username &&
      !value.password &&
      !/[\s\u0000-\u001f\u007f]/.test(raw)
    );
  } catch {
    return false;
  }
}
