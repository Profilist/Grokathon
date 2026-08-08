import { describe, expect, it } from "vitest";
import {
  canJoinLobby,
  fallbackPlayerHandle,
  getPlayerHasPlayed,
  getPlayerResult,
  getLobbyRole,
  handlesMatch,
  shouldShowSpectatorView,
  type GameLobby,
} from "./lobby";

const lobby: GameLobby = {
  slug: "demo",
  host_user_id: "host-id",
  host_handle: "larris",
  guest_user_id: null,
  guest_handle: null,
  host_has_played: false,
  guest_has_played: false,
  host_move: null,
  guest_move: null,
  winner: null,
  status: "open",
  created_at: "2026-08-08T00:00:00Z",
  updated_at: "2026-08-08T00:00:00Z",
};

describe("lobby helpers", () => {
  it("matches X handles case-insensitively", () => {
    expect(handlesMatch("@Larris", "larris")).toBe(true);
    expect(handlesMatch("larris", "teammate")).toBe(false);
  });

  it("identifies lobby roles", () => {
    expect(getLobbyRole(lobby, "host-id")).toBe("host");
    expect(getLobbyRole({ ...lobby, guest_user_id: "guest-id" }, "guest-id")).toBe(
      "guest",
    );
    expect(getLobbyRole(lobby, "viewer-id")).toBe("viewer");
  });

  it("only permits an unseated non-host to join", () => {
    expect(canJoinLobby(lobby, "viewer-id")).toBe(true);
    expect(canJoinLobby(lobby, "host-id")).toBe(false);
    expect(
      canJoinLobby(
        { ...lobby, guest_user_id: "guest-id", guest_handle: "teammate", status: "ready" },
        "viewer-id",
      ),
    ).toBe(false);
  });

  it("switches a full lobby to spectating only for unseated viewers", () => {
    const fullLobby: GameLobby = {
      ...lobby,
      guest_user_id: "guest-id",
      guest_handle: "teammate",
      status: "ready",
    };

    expect(shouldShowSpectatorView(lobby, "viewer")).toBe(false);
    expect(shouldShowSpectatorView(fullLobby, "viewer")).toBe(true);
    expect(shouldShowSpectatorView(fullLobby, "host")).toBe(false);
    expect(shouldShowSpectatorView(fullLobby, "guest")).toBe(false);
  });

  it("creates a short stable anonymous display name", () => {
    expect(fallbackPlayerHandle("12345678-abcd-ef00-1234-567890abcdef")).toBe(
      "player-123456",
    );
  });

  it("reports submitted moves and player outcomes", () => {
    const completeLobby: GameLobby = {
      ...lobby,
      guest_user_id: "guest-id",
      guest_handle: "teammate",
      host_has_played: true,
      guest_has_played: true,
      host_move: "rock",
      guest_move: "scissors",
      winner: "host",
      status: "complete",
    };

    expect(getPlayerHasPlayed(completeLobby, "host")).toBe(true);
    expect(getPlayerResult(completeLobby, "host")).toBe("won");
    expect(getPlayerResult(completeLobby, "guest")).toBe("lost");
    expect(getPlayerResult({ ...completeLobby, winner: "draw" }, "guest")).toBe("draw");
    expect(getPlayerResult(completeLobby, "viewer")).toBe(null);
  });
});
