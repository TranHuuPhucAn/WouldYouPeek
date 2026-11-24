import { describe, expect, it } from "vitest";
import { fixtureSqlFailure } from "../integration/helpers/database";

const canary = "PRIVATE_SQL_ROWS_OR_CREDENTIAL_CANARY";
const codes = [
  "EDITORIAL_REPAIR_REQUIRES_POSTGRES",
  "EDITORIAL_REPAIR_TARGET_MISMATCH",
  "EDITORIAL_REPAIR_REVIEW_REQUIRED",
  "EDITORIAL_REPAIR_INVALID_SOURCES",
  "EDITORIAL_REPAIR_ORDER_MISMATCH",
  "EDITORIAL_REPAIR_PUBLICATION_CHANGED",
  "EDITORIAL_REPAIR_SOURCE_UNAVAILABLE",
  "EDITORIAL_REPAIR_SOURCE_CHANGED",
  "EDITORIAL_REPAIR_GENERATION_CHANGED",
  "EDITORIAL_REPAIR_MEDIA_UNAVAILABLE",
];

describe("disposable fixture error privacy", () => {
  it.each(codes)("retains only the primary maintenance code %s", (code) => {
    const source = Object.assign(new Error(canary), {
      stderr: Buffer.from(
        `NOTICE: ${canary}\nERROR:  ${code}\nDETAIL: ${canary}\nCONTEXT: SQL statement '${canary}'\n`,
      ),
      stdout: canary,
      input: canary,
    });
    const failure = fixtureSqlFailure(source);
    expect(failure.stderr).toBe(`ERROR: ${code}\n`);
    expect(failure.message).toBe("Disposable fixture database operation failed.");
    expect(JSON.stringify(failure) + failure.message).not.toContain(canary);
  });

  it.each([
    `DETAIL: ${codes[0]}\nCONTEXT: ${codes[1]}`,
    `ERROR: UNKNOWN_FAILURE\nDETAIL: ${codes[0]}`,
    `ERROR: UNKNOWN_FAILURE\nERROR: ${codes[0]}`,
    `ERROR: ${codes[0]} ${canary}`,
    "ERROR: EDITORIAL_REPAIR_UNREVIEWED_CODE",
    `LINE 1: raise exception '${codes[0]}';`,
  ])("does not promote non-primary or unknown text: case %#", (stderr) => {
    const failure = fixtureSqlFailure({ stderr, stdout: canary });
    expect(failure.stderr).toBeUndefined();
    expect(JSON.stringify(failure) + failure.message).not.toContain(canary);
  });

  it("does not infer an error code from SQL input, stdout or exception messages", () => {
    const failure = fixtureSqlFailure({
      message: `ERROR: ${codes[0]}`,
      input: `raise exception '${codes[0]}'; ${canary}`,
      stdout: `ERROR: ${codes[0]}`,
    });
    expect(failure.stderr).toBeUndefined();
  });

  it("supports psql's fixed stdin location prefix without retaining it", () => {
    const failure = fixtureSqlFailure({
      stderr: `psql:<stdin>:16: ERROR: ${codes[0]}\nCONTEXT: ${canary}`,
    });
    expect(failure.stderr).toBe(`ERROR: ${codes[0]}\n`);
    expect(JSON.stringify(failure)).not.toContain(canary);
    expect(JSON.stringify(failure)).not.toContain("<stdin>");
  });

  it("refuses a truncated primary line instead of dropping its unknown suffix", () => {
    const failure = fixtureSqlFailure({
      stderr: `ERROR: ${codes[0]}${" ".repeat(32_768)}${canary}`,
    });
    expect(failure.stderr).toBeUndefined();
  });

  it("handles unknown stderr shapes without exposing their contents", () => {
    for (const error of [null, { stderr: { message: canary } }, Object.defineProperty({}, "stderr", {
      get() { throw new Error(canary); },
    })]) {
      const failure = fixtureSqlFailure(error);
      expect(failure.stderr).toBeUndefined();
      expect(failure.message).toBe("Disposable fixture database operation failed.");
    }
  });
});
