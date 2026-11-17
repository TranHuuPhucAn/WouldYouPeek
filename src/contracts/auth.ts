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
