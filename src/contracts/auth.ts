export type AccountUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  role: "learner" | "creator";
  capabilities: ("learn" | "create")[];
  createdAt: string;
};

export type AuthFormState = {
  status: "idle" | "error" | "success";
  message?: string;
  fieldErrors?: Partial<
    Record<"email" | "password" | "confirmPassword", string>
  >;
  retryAfter?: number;
};

export const INITIAL_AUTH_STATE: AuthFormState = { status: "idle" };

export const NEW_PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;
export const NEW_PASSWORD_HINT =
  "Use 8–128 characters with uppercase, lowercase, a number and a symbol.";

export type AuthChallengeConfig =
  { kind: "none" } | { kind: "turnstile"; siteKey: string };
