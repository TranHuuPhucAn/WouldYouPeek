import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerNameField } from "@/components/creator/PlayerNameField";
import { listLibraryPlayers } from "@/lib/client/library-api";
import type { PlayerListResponse } from "@/contracts/player";
import {
  normalizePlayerDisplayName,
  normalizePlayerKey,
} from "@/lib/players/identity";

vi.mock("@/lib/client/library-api", () => ({ listLibraryPlayers: vi.fn() }));

function result(
  name: string,
  id = "11111111-1111-4111-8111-111111111111",
): PlayerListResponse {
  return {
    players: [
      { player: { id, displayName: name }, scenarioCount: 1, scenarios: [] },
    ],
    nextCursor: null,
  };
}

function Harness({
  onChange,
  initial = "",
}: {
  onChange: (value: string) => void;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <PlayerNameField
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function suggestions(input: HTMLElement) {
  const listId = input.getAttribute("list");
  expect(listId).toBeTruthy();
  const list = document.getElementById(listId!);
  expect(list?.tagName).toBe("DATALIST");
  return [...(list?.querySelectorAll("option") ?? [])].map(
    (option) => option.value,
  );
}

async function runDebounce() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(listLibraryPlayers)
    .mockReset()
    .mockResolvedValue({ players: [], nextCursor: null });
});
afterEach(() => vi.useRealTimers());

describe("recorded player name", () => {
  it.each(["A".repeat(300), "🎮".repeat(300), "ﷺ".repeat(300)])(
    "keeps a valid 300-code-point credit editable and bounds its suggestion query %#",
    async (name) => {
      const onChange = vi.fn();
      render(<Harness initial={name} onChange={onChange} />);
      const input = screen.getByLabelText(
        "Player in the recording",
      ) as HTMLInputElement;
      expect(input).toHaveValue(name);
      expect(input.maxLength).toBe(600);
      expect(input).toBeValid();
      fireEvent.focus(input);
      await runDebounce();
      expect(listLibraryPlayers).toHaveBeenLastCalledWith(
        { query: [...normalizePlayerKey(name)].slice(0, 100).join("") },
        expect.any(AbortSignal),
      );
      expect(input).toHaveValue(name);
      expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("reports raw code-point overflow without truncating the author's edit and clears it on correction", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Player in the recording");
    const tooLong = "a".repeat(301);
    fireEvent.change(input, { target: { value: tooLong } });
    expect(input).toHaveValue(tooLong);
    expect(onChange).toHaveBeenLastCalledWith(tooLong);
    expect(input).toBeInvalid();
    expect(screen.getByText(/Use at most 300 characters/)).toBeVisible();
    fireEvent.change(input, { target: { value: "🎮".repeat(300) } });
    expect(input).toBeValid();
    expect(
      screen.queryByText(/Use at most 300 characters/),
    ).not.toBeInTheDocument();
  });

  it("omits canonical suggestions too long for the source field while retaining expanded original text", async () => {
    const raw = "ﷺ".repeat(300);
    const canonical = normalizePlayerDisplayName(raw);
    expect([...canonical].length).toBeGreaterThan(300);
    vi.mocked(listLibraryPlayers).mockResolvedValue({
      players: [
        ...result(canonical).players,
        ...result("TenZ", "22222222-2222-4222-8222-222222222222").players,
      ],
      nextCursor: null,
    });
    const onChange = vi.fn();
    render(<Harness initial={raw} onChange={onChange} />);
    const input = screen.getByLabelText("Player in the recording");
    fireEvent.focus(input);
    await runDebounce();
    expect(suggestions(input)).toEqual(["TenZ"]);
    expect(input).toHaveValue(raw);
    expect(onChange).not.toHaveBeenCalled();
  });
  it("offers a labelled native suggestion list without changing the authored name", async () => {
    vi.mocked(listLibraryPlayers).mockResolvedValue(result("TenZ"));
    const onChange = vi.fn();
    render(<Harness initial="ten" onChange={onChange} />);
    const input = screen.getByLabelText("Player in the recording");
    fireEvent.focus(input);
    await runDebounce();

    expect(listLibraryPlayers).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "ten" }),
      expect.any(AbortSignal),
    );
    expect(suggestions(input)).toContain("TenZ");
    expect(input).toHaveValue("ten");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("accepts a suggested spelling or a completely new name as an ordinary draft edit", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Player in the recording");
    fireEvent.change(input, { target: { value: "TenZ" } });
    expect(onChange).toHaveBeenLastCalledWith("TenZ");
    fireEvent.change(input, { target: { value: "A new recording player" } });
    expect(input).toHaveValue("A new recording player");
    expect(onChange).toHaveBeenLastCalledWith("A new recording player");
    await runDebounce();
    expect(input).toHaveValue("A new recording player");
  });

  it("ignores an old lookup that resolves after a newer query", async () => {
    let resolveFirst!: (value: PlayerListResponse) => void;
    let resolveSecond!: (value: PlayerListResponse) => void;
    vi.mocked(listLibraryPlayers)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const onChange = vi.fn();
    render(<Harness initial="ten" onChange={onChange} />);
    const input = screen.getByLabelText("Player in the recording");
    fireEvent.focus(input);
    await runDebounce();
    const oldSignal = vi.mocked(listLibraryPlayers).mock.calls[0][1];
    fireEvent.change(input, { target: { value: "new" } });
    await runDebounce();
    await act(async () => {
      resolveSecond(result("New player"));
    });
    await act(async () => {
      resolveFirst(result("TenZ"));
    });

    expect(oldSignal?.aborted).toBe(true);
    expect(suggestions(input)).toEqual(["New player"]);
    expect(input).toHaveValue("new");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("leaves manual input usable when the catalogue request fails", async () => {
    vi.mocked(listLibraryPlayers).mockRejectedValue(
      new Error("Catalogue offline"),
    );
    const onChange = vi.fn();
    render(<Harness initial="TenZ" onChange={onChange} />);
    const input = screen.getByLabelText("Player in the recording");
    fireEvent.focus(input);
    await runDebounce();
    expect(input).toBeEnabled();
    fireEvent.change(input, { target: { value: "Another player" } });
    expect(input).toHaveValue("Another player");
    expect(onChange).toHaveBeenLastCalledWith("Another player");
    await runDebounce();
  });

  it("cancels a pending lookup when the editor field unmounts", async () => {
    let resolve!: (value: PlayerListResponse) => void;
    vi.mocked(listLibraryPlayers).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const onChange = vi.fn();
    const view = render(<Harness initial="TenZ" onChange={onChange} />);
    fireEvent.focus(screen.getByLabelText("Player in the recording"));
    await runDebounce();
    const signal = vi.mocked(listLibraryPlayers).mock.calls[0][1];
    view.unmount();
    await act(async () => {
      resolve(result("TenZ"));
    });
    expect(signal?.aborted).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
