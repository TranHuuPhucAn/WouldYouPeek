export function SessionPersistenceNotice({
  pending,
  error,
  unresolved,
  onRetry,
}: {
  pending: boolean;
  error: string | null;
  unresolved: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={`persistence-notice ${error ? "has-error" : ""}`}
      role={error ? "alert" : "status"}
      aria-live="polite"
    >
      {pending ? (
        "Saving your progress…"
      ) : error ? (
        <>
          {error}{" "}
          {unresolved && (
            <button className="text-button" onClick={onRetry}>
              Retry save
            </button>
          )}
        </>
      ) : (
        "Progress saved. Choices save when you lock them in."
      )}
    </div>
  );
}
