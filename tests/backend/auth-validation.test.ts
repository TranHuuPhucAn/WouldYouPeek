import { describe, it, expect } from "vitest";
import {
  parseSignInInput,
  parseSignUpInput,
  parseResetRequest,
  parseNewPassword,
} from "@/server/auth/validation";
describe("account input boundaries", () => {
  it("normalizes email but preserves exact passwords", () =>
    expect(
      parseSignInInput({ email: " A@Example.com ", password: " a password " }),
    ).toEqual({ email: "a@example.com", password: " a password " }));
  it.each([
    null,
    [],
    {},
    { email: "a@b.com", password: "pass", role: "creator" },
    { email: "a@b.com", password: "" },
    { email: "a@b.com", password: "a".repeat(129) },
    { email: "bad", password: "x" },
  ])("rejects malformed/injected sign-in %j", (input) =>
    expect(() => parseSignInInput(input)).toThrow(),
  );
  it("accepts matching eight-character signup passwords", () =>
    expect(
      parseSignUpInput({
        email: "a@b.com",
        password: "Abcd123!",
        confirmPassword: "Abcd123!",
      }),
    ).toEqual({ email: "a@b.com", password: "Abcd123!" }));
  it.each([
    "Abcd12!",
    "Abcd123!" + "a".repeat(121),
    "abcd123!",
    "ABCD123!",
    "Abcdefg!",
    "Abcd1234",
    "Abcd123 ",
    "Abcd123😀",
  ])("rejects weak new password %s", (password) =>
    expect(() =>
      parseNewPassword({ password, confirmPassword: password }),
    ).toThrow(),
  );
  it.each(["Abcd123!", "Abcd123!" + "a".repeat(120), " Abcd123! "])(
    "accepts valid reset boundaries without trimming %s",
    (password) =>
      expect(parseNewPassword({ password, confirmPassword: password })).toEqual(
        {
          password,
        },
      ),
  );
  it.each(["[", "]", "{", "}", "\\", "'", '"', "-", "`", "~"])(
    "accepts supported punctuation %s",
    (symbol) => {
      const password = `Abcd123${symbol}`;
      expect(parseNewPassword({ password, confirmPassword: password })).toEqual(
        {
          password,
        },
      );
    },
  );
  it.each(["x", "Abcd1234", " a password "])(
    "allows existing passwords at sign-in %s",
    (password) =>
      expect(parseSignInInput({ email: "a@b.com", password }).password).toBe(
        password,
      ),
  );
  it("reports confirmation mismatch", () =>
    expect(() =>
      parseNewPassword({
        password: "Abcd123!",
        confirmPassword: "different",
      }),
    ).toThrow(
      expect.objectContaining({
        fieldErrors: { confirmPassword: "Passwords must match." },
      }),
    ));
  it("rejects role injection on signup and reset", () => {
    expect(() =>
      parseSignUpInput({
        email: "a@b.com",
        password: "Abcd123!",
        confirmPassword: "Abcd123!",
        role: "creator",
      }),
    ).toThrow();
    expect(() =>
      parseResetRequest({ email: "a@b.com", userId: "other" }),
    ).toThrow();
  });
});
