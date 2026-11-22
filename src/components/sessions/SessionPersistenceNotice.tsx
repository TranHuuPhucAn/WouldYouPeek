export function SessionPersistenceNotice({
  pending,
  error,
  unresolved,
  onRetry,
  ending = false,
}: {
  pending: boolean;
  error: string | null;
  unresolved: boolean;
  onRetry: () => void;
  ending?: boolean;
}) {
  return (
    <div
      className={`persistence-notice ${error ? "has-error" : ""}`}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      {pending ? (
        ending ? (
          "Ending your session…"
        ) : (
          "Saving your progress…"
        )
      ) : error ? (
        <>
          {error}{" "}
          {unresolved && (
            <button className="text-button" onClick={onRetry}>
              {ending ? "Retry ending session" : "Retry save"}
            </button>
          )}
        </>
      ) : (
        "Progress saved. Choices save when you lock them in."
      )}
    </div>
  );
}
