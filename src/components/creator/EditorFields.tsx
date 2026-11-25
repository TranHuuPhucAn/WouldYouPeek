"use client";
import type { ValidationIssue } from "@/contracts/creator";
export function fieldId(path: string) {
  const inputPath = path
    .replace(/^(knownFacts|unknowns|analysis\.limitations)\.\d+$/, "$1")
    .replace(/^(options\.\d+\.(?:acceptableWhen|risks))\.\d+$/, "$1");
  return `creator-${inputPath.replace(/[^a-zA-Z0-9-]/g, "-")}`;
}
export type FieldProps = {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  issues?: ValidationIssue[];
  maxLength?: number;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
  type?: string;
};
export function TextField({
  path,
  label,
  value,
  onChange,
  issues = [],
  maxLength = 2000,
  hint,
  multiline,
  placeholder,
  type = "text",
}: FieldProps) {
  const error = issues.find(
    (issue) => issue.path === path || issue.path.startsWith(`${path}.`),
  )?.message;
  const id = fieldId(path);
  const common = {
    id,
    name: path,
    value,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => onChange(event.target.value),
    maxLength,
    placeholder,
    "aria-invalid": !!error,
    "aria-describedby": `${id}-hint${error ? ` ${id}-error` : ""}`,
  };
  return (
    <div className="creator-field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={4} />
      ) : (
        <input {...common} type={type} />
      )}
      <small id={`${id}-hint`}>
        {hint ?? `${value.length}/${maxLength} characters`}
      </small>
      {error && (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}
export function SelectField({
  path,
  label,
  value,
  onChange,
  choices,
  issues = [],
}: {
  path: string;
  label: string;
  value: string;
  onChange: (value: string) => void | boolean;
  choices: { value: string; label: string }[];
  issues?: ValidationIssue[];
}) {
  const error = issues.find((issue) => issue.path === path)?.message;
  return (
    <div className="creator-field">
      <label htmlFor={fieldId(path)}>{label}</label>
      <select
        id={fieldId(path)}
        value={value}
        onChange={(event) => {
          const selection = event.currentTarget;
          if (onChange(selection.value) === false) selection.value = value;
        }}
        aria-invalid={!!error}
        aria-describedby={error ? `${fieldId(path)}-error` : undefined}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
      {error && (
        <p className="field-error" id={`${fieldId(path)}-error`}>
          {error}
        </p>
      )}
    </div>
  );
}
export function ListField(
  props: Omit<FieldProps, "value" | "onChange"> & {
    value: string[];
    onChange: (value: string[]) => void;
  },
) {
  return (
    <TextField
      {...props}
      value={props.value.join("\n")}
      onChange={(text) => props.onChange(text ? text.split("\n") : [])}
      multiline
      maxLength={3009}
      hint={
        props.hint ??
        "One item per line. Up to 10 items, 300 characters each. Leave empty when there are no additional entries."
      }
    />
  );
}
