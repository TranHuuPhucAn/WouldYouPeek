"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
const Context = createContext<{
  suspended: boolean;
  setDialog: (id: string, open: boolean) => void;
} | null>(null);
/** A scenario preview and its start controls share the same modal playback pause. */
export function ScenarioInteractionScope({
  children,
}: {
  children: ReactNode;
}) {
  const [dialogs, setDialogs] = useState<ReadonlySet<string>>(() => new Set());
  const setDialog = useCallback(
    (id: string, open: boolean) =>
      setDialogs((previous) => {
        if (previous.has(id) === open) return previous;
        const next = new Set(previous);
        if (open) next.add(id);
        else next.delete(id);
        return next;
      }),
    [],
  );
  const value = useMemo(
    () => ({ suspended: dialogs.size > 0, setDialog }),
    [dialogs, setDialog],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useScenarioDialog(open: boolean) {
  const id = useId(),
    setDialog = useContext(Context)?.setDialog;
  useEffect(() => {
    if (!open || !setDialog) return;
    setDialog(id, true);
    return () => setDialog(id, false);
  }, [id, open, setDialog]);
}
export function useScenarioMediaSuspended() {
  return useContext(Context)?.suspended ?? false;
}
