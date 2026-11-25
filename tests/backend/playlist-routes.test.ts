import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  getCreatorProfile: vi.fn(),
  saveCreatorProfile: vi.fn(),
  listPublishedPlaylists: vi.fn(),
  createPlaylist: vi.fn(),
  listOwnedPlaylists: vi.fn(),
  savePlaylist: vi.fn(),
  findOwnedPlaylist: vi.fn(),
  recordPlaylistReview: vi.fn(),
  getPlaylistReviewPreview: vi.fn(),
}));
vi.mock("@/server/account/creator-profile/service", () => mocks);
vi.mock("@/server/creator-playlists/service", () => mocks);
vi.mock("@/server/playlists/service", () => mocks);
import * as profile from "@/app/api/account/creator-profile/route";
import * as library from "@/app/api/library/playlists/route";
import * as owner from "@/app/api/creator/playlists/route";
import * as detail from "@/app/api/creator/playlists/[id]/route";
import * as review from "@/app/api/creator/playlists/[id]/review/route";
import { playlistId } from "./helpers/playlist";
const origin = "http://127.0.0.1:3000",
  ctx = { params: Promise.resolve({ id: playlistId }) };
function request(path: string, body: unknown, originHeader = origin) {
  return new Request(`${origin}${path}`, {
    method: "POST",
    headers: { Origin: originHeader, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  Object.values(mocks).forEach((m) =>
    m.mockReset().mockResolvedValue({ ok: true }),
  );
});
afterEach(() => vi.unstubAllEnvs());
describe("playlist route boundaries", () => {
  it("rejects repeated or private query fields before service calls", async () => {
    for (const q of [
      "query=a&query=b",
      "playerId=a&playerId=b",
      "creatorId=private",
      "limit=100",
    ]) {
      expect(
        (await library.GET(new Request(`${origin}/api/library/playlists?${q}`)))
          .status,
      ).toBe(400);
    }
    expect(mocks.listPublishedPlaylists).not.toHaveBeenCalled();
    expect(
      (
        await profile.GET(
          new Request(`${origin}/api/account/creator-profile?owner=private`),
        )
      ).status,
    ).toBe(400);
  });
  it("forwards only supported listing parameters and disables shared caching", async () => {
    const result = await library.GET(
      new Request(
        `${origin}/api/library/playlists?query=TenZ&playerId=${playlistId}&cursor=abc`,
      ),
    );
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(mocks.listPublishedPlaylists).toHaveBeenCalledWith(
      "TenZ",
      playlistId,
      "abc",
    );
    await owner.GET(
      new Request(`${origin}/api/creator/playlists?status=withdrawn`),
    );
    expect(mocks.listOwnedPlaylists).toHaveBeenCalledWith(null, "withdrawn");
  });
  it("requires same-origin JSON on all playlist/profile edits", async () => {
    for (const operation of [
      () =>
        profile.PUT(
          request("/api/account/creator-profile", {}, "https://other.example"),
        ),
      () =>
        owner.POST(
          request("/api/creator/playlists", {}, "https://other.example"),
        ),
      () =>
        detail.PUT(
          request("/api/creator/playlists/x", {}, "https://other.example"),
          ctx,
        ),
      () =>
        review.POST(
          request(
            "/api/creator/playlists/x/review",
            {},
            "https://other.example",
          ),
          ctx,
        ),
    ])
      expect((await operation()).status).toBe(400);
    expect(mocks.saveCreatorProfile).not.toHaveBeenCalled();
    expect(mocks.createPlaylist).not.toHaveBeenCalled();
    expect(mocks.savePlaylist).not.toHaveBeenCalled();
    expect(mocks.recordPlaylistReview).not.toHaveBeenCalled();
  });
  it("bounds profile and playlist request bodies", async () => {
    expect(
      (
        await profile.PUT(
          request("/api/account/creator-profile", {
            displayName: "a".repeat(4096),
          }),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await detail.PUT(
          request("/api/creator/playlists/x", {
            description: "a".repeat(16384),
          }),
          ctx,
        )
      ).status,
    ).toBe(413);
    expect(mocks.savePlaylist).not.toHaveBeenCalled();
    expect(mocks.saveCreatorProfile).not.toHaveBeenCalled();
  });
});
