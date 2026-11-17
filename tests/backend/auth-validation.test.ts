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
  it("accepts matching strong passwords", () =>
    expect(
      parseSignUpInput({
        email: "a@b.com",
        password: "Password12345",
        confirmPassword: "Password12345",
      }),
    ).toEqual({ email: "a@b.com", password: "Password12345" }));
  it.each([
    "shortA1",
    "alllowercase123",
    "ALLUPPERCASE123",
    "NoNumbersPassword",
  ])("rejects weak new password %s", (password) =>
    expect(() =>
      parseNewPassword({ password, confirmPassword: password }),
    ).toThrow(),
  );
  it("reports confirmation mismatch", () =>
    expect(() =>
      parseNewPassword({
        password: "Password12345",
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
        password: "Password12345",
        confirmPassword: "Password12345",
        role: "creator",
      }),
    ).toThrow();
    expect(() =>
      parseResetRequest({ email: "a@b.com", userId: "other" }),
    ).toThrow();
  });
});
