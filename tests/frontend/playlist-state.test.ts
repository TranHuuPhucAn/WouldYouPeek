import { describe, it, expect } from "vitest";
import {
  addPlaylistItem,
  movePlaylistItem,
  removePlaylistItem,
  replacePlaylistItemVersion,
} from "@/lib/playlists/ordering";
import {
  createPlaylistEditorState,
  buildPlaylistSaveCommand,
  isPlaylistEditorDirty,
  playlistEditorReducer as reduce,
} from "@/lib/playlists/editor-state";
import { playlistSnapshot, candidate } from "./playlist-fixtures";
describe("playlist ordering and save recovery", () => {
  it("keeps pins through reordering, duplicate rejection, removal, and explicit replacement", () => {
    const items = playlistSnapshot().draft.content.items;
    expect(addPlaylistItem(items, candidate())).toBe(items);
    expect(movePlaylistItem(items, items[0].scenarioId, -1)).toBe(items);
    const moved = movePlaylistItem(items, items[1].scenarioId, -1);
    expect(moved).toEqual([items[1], items[0]]);
    expect(items[0].scenarioId).toBe(candidate().scenarioId);
    expect(removePlaylistItem(moved, items[1].scenarioId)).toEqual([items[0]]);
    expect(
      replacePlaylistItemVersion(items, items[0].scenarioId, {
        ...candidate(),
        scenarioVersion: "creator-2",
      })[0].scenarioVersion,
    ).toBe("creator-2");
    const full = Array.from({ length: 20 }, (_, i) => candidate(i));
    expect(addPlaylistItem(full, candidate(21))).toBe(full);
  });
  it("preserves typing during save and a frozen retry after unknown outcome", () => {
    let state = createPlaylistEditorState(playlistSnapshot());
    state = reduce(state, {
      type: "EDIT",
      content: { ...state.content, title: "Saved title" },
    });
    const command = buildPlaylistSaveCommand(state, "request");
    state = reduce(state, { type: "START", command });
    state = reduce(state, {
      type: "EDIT",
      content: { ...state.content, title: "Later typing" },
    });
    state = reduce(state, {
      type: "FAILED",
      message: "Offline",
      retainCommand: true,
    });
    expect(state.command?.content.title).toBe("Saved title");
    const saved = playlistSnapshot();
    saved.revision = 2;
    saved.draft = { ...saved.draft, revision: 2, content: command.content };
    state = reduce(state, {
      type: "SAVED",
      snapshot: saved,
      submitted: command.content,
    });
    expect(state.content.title).toBe("Later typing");
    expect(isPlaylistEditorDirty(state)).toBe(true);
    expect(state.command).toBeNull();
  });
  it("does not rebase edits onto another tabs canonical replay and clears on identity loss", () => {
    const initial = createPlaylistEditorState(playlistSnapshot());
    const next = playlistSnapshot();
    next.revision = 5;
    next.draft.revision = 4;
    next.draft.content.title = "Another tab";
    const conflict = reduce(initial, {
      type: "SAVED",
      snapshot: next,
      submitted: initial.content,
    });
    expect(conflict.conflict).toBe(true);
    expect(conflict.content.title).toBe(initial.content.title);
    expect(reduce(conflict, { type: "ACCEPT_LATEST" }).content.title).toBe(
      "Another tab",
    );
    const invalid = reduce(conflict, { type: "INVALIDATE" });
    expect(invalid.content).toEqual({});
    expect(reduce(invalid, { type: "EDIT", content: initial.content })).toBe(
      invalid,
    );
  });
});
