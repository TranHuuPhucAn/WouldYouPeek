import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";

export const VALIDATOR_ROLE = "wyp_media_validator";
export type MediaWorkerConfig = {
  schemaVersion: 1;
  projectId: string;
  apiUrl: string;
  publishableKey: string;
  validatorToken: string;
  ffprobePath: string;
};

const projectPattern = /^(would-you-peek|wyp-test-[0-9a-f-]{31})$/;

/** This rejects configuration mistakes; Supabase verifies the JWT signature. */
export function assertValidatorIdentity(
  token: string,
  projectId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !part)) throw new Error();
    const header = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8"),
    );
    if (
      header.alg !== "HS256" ||
      claims.role !== VALIDATOR_ROLE ||
      claims.wyp_project_id !== projectId ||
      !Number.isInteger(claims.exp) ||
      !Number.isInteger(claims.iat) ||
      claims.exp <= nowSeconds + 15 ||
      claims.iat > nowSeconds + 30 ||
      claims.exp - claims.iat > 8 * 60 * 60
    )
      throw new Error();
    return { expiresAt: claims.exp as number };
  } catch {
    throw new Error(
      "The local media validator credential is invalid or expired. Run npm run media:setup.",
    );
  }
}

export function validateMediaWorkerConfig(value: unknown): MediaWorkerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid local media worker configuration.");
  const input = value as Record<string, unknown>;
  const keys = [
    "schemaVersion",
    "projectId",
    "apiUrl",
    "publishableKey",
    "validatorToken",
    "ffprobePath",
  ];
  if (
    Object.keys(input).some((key) => !keys.includes(key)) ||
    input.schemaVersion !== 1 ||
    typeof input.projectId !== "string" ||
    !projectPattern.test(input.projectId) ||
    keys
      .slice(2)
      .some(
        (key) =>
          typeof input[key] !== "string" ||
          !input[key] ||
          String(input[key]).includes("\0"),
      )
  )
    throw new Error("Invalid local media worker configuration.");
  const config = input as MediaWorkerConfig;
  const url = new URL(config.apiUrl);
  const expectedPort =
    config.projectId === "would-you-peek" ? "54321" : "55321";
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.port !== expectedPort ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error(
      "The media validator only supports the configured local Supabase project.",
    );
  if (!config.publishableKey.startsWith("sb_publishable_")) {
    try {
      const keyClaims = JSON.parse(
        Buffer.from(config.publishableKey.split(".")[1], "base64url").toString(
          "utf8",
        ),
      );
      if (keyClaims.role !== "anon") throw new Error();
    } catch {
      throw new Error(
        "Use a local publishable or anonymous API key, never an administrator key.",
      );
    }
  }
  assertValidatorIdentity(config.validatorToken, config.projectId);
  return { ...config, apiUrl: url.origin };
}

export function loadMediaWorkerConfig(configPath: string): MediaWorkerConfig {
  const path = resolve(configPath);
  const stat = lstatSync(path);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    realpathSync(path) !== path ||
    (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
  )
    throw new Error(
      "The media worker configuration must be a private regular file (mode 0600).",
    );
  if (stat.size > 16_384)
    throw new Error("Invalid local media worker configuration.");
  return validateMediaWorkerConfig(JSON.parse(readFileSync(path, "utf8")));
}
