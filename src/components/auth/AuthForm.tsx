"use client";
import { useActionState, useEffect, useId, useRef, useState } from "react";
import { INITIAL_AUTH_STATE, type AuthFormState } from "@/contracts/auth";
type Field = "email" | "password" | "confirmPassword";
export function AuthForm({
  action,
  fields,
  label,
  returnTo,
  newPassword = false,
}: {
  action: (state: AuthFormState, data: FormData) => Promise<AuthFormState>;
  fields: Field[];
  label: string;
  returnTo?: string;
  newPassword?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    action,
    INITIAL_AUTH_STATE,
  );
  const [cooldown, setCooldown] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  useEffect(() => {
    if (state.status !== "idle") summary.current?.focus();
  }, [state]);
  useEffect(() => {
    setCooldown(state.retryAfter ?? 0);
  }, [state]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const labels = {
    email: "Email",
    password: newPassword ? "New password" : "Password",
    confirmPassword: "Confirm password",
  };
  return (
    <form
      ref={form}
      action={formAction}
      className="auth-form"
      aria-label={label}
    >
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      {fields.map((field) => (
        <div className="form-field" key={field}>
          <label htmlFor={`${id}-${field}`}>{labels[field]}</label>
          <input
            id={`${id}-${field}`}
            name={field}
            type={field === "email" ? "email" : "password"}
            required
            maxLength={field === "email" ? 254 : 128}
            minLength={field !== "email" && newPassword ? 12 : undefined}
            autoComplete={
              field === "email"
                ? "email"
                : newPassword || field === "confirmPassword"
                  ? "new-password"
                  : "current-password"
            }
            aria-invalid={!!state.fieldErrors?.[field]}
            aria-describedby={
              state.fieldErrors?.[field]
                ? `${id}-${field}-error`
                : field === "password" && newPassword
                  ? `${id}-password-hint`
                  : undefined
            }
            onInput={() => {
              const target = form.current?.elements.namedItem(
                "confirmPassword",
              ) as HTMLInputElement | null;
              const password = form.current?.elements.namedItem(
                "password",
              ) as HTMLInputElement | null;
              if (target)
                target.setCustomValidity(
                  target.value && target.value !== password?.value
                    ? "Passwords must match."
                    : "",
                );
            }}
          />
          {field === "password" && newPassword && (
            <small id={`${id}-password-hint`}>
              Use 12–128 characters, with an uppercase letter, a lowercase
              letter and a number.
            </small>
          )}
          {state.fieldErrors?.[field] && (
            <p id={`${id}-${field}-error`} className="field-error">
              {state.fieldErrors[field]}
            </p>
          )}
        </div>
      ))}
      {state.status !== "idle" && (
        <div
          ref={summary}
          tabIndex={-1}
          role={state.status === "error" ? "alert" : "status"}
          className={`form-message ${state.status}`}
        >
          {state.message ??
            (state.status === "error"
              ? "Please check the fields above."
              : "Done.")}
        </div>
      )}
      <button
        type="submit"
        className="button button-primary"
        disabled={pending || cooldown > 0}
      >
        {pending
          ? "Please wait…"
          : cooldown
            ? `Try again in ${cooldown}s`
            : label}
      </button>
    </form>
  );
}
