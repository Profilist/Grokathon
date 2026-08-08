export type RpsMove = "rock" | "paper" | "scissors";
export type GameStatus = "open" | "ready" | "playing" | "complete";
export type GameWinner = "host" | "guest" | "draw";

export interface GameLobby {
  slug: string;
  host_user_id: string;
  host_handle: string;
  guest_user_id: string | null;
  guest_handle: string | null;
  host_has_played: boolean;
  guest_has_played: boolean;
  host_move: RpsMove | null;
  guest_move: RpsMove | null;
  winner: GameWinner | null;
  status: GameStatus;
  created_at: string;
  updated_at: string;
}

export type LobbyRole = "host" | "guest" | "viewer";

export function handlesMatch(left: string | null, right: string | null): boolean {
  if (!left || !right) return false;
  return left.replace(/^@/, "").toLowerCase() === right.replace(/^@/, "").toLowerCase();
}

export function getLobbyRole(lobby: GameLobby | null, userId: string | null): LobbyRole {
  if (!lobby || !userId) return "viewer";
  if (lobby.host_user_id === userId) return "host";
  if (lobby.guest_user_id === userId) return "guest";
  return "viewer";
}

export function canJoinLobby(lobby: GameLobby | null, userId: string | null): boolean {
  return Boolean(
    lobby &&
      userId &&
      lobby.status === "open" &&
      lobby.guest_user_id === null &&
      lobby.host_user_id !== userId,
  );
}

export function shouldShowSpectatorView(
  lobby: GameLobby | null,
  role: LobbyRole,
): boolean {
  return Boolean(lobby?.guest_user_id && role === "viewer");
}

export function fallbackPlayerHandle(userId: string): string {
  return `player-${userId.replaceAll("-", "").slice(0, 6)}`;
}

export function getPlayerHasPlayed(lobby: GameLobby | null, role: LobbyRole): boolean {
  if (!lobby) return false;
  if (role === "host") return lobby.host_has_played;
  if (role === "guest") return lobby.guest_has_played;
  return false;
}

export function getPlayerResult(
  lobby: GameLobby | null,
  role: LobbyRole,
): "won" | "lost" | "draw" | null {
  if (!lobby || lobby.status !== "complete" || !lobby.winner) return null;
  if (lobby.winner === "draw") return "draw";
  if (role === lobby.winner) return "won";
  if (role === "host" || role === "guest") return "lost";
  return null;
}

export function isRpsMove(value: unknown): value is RpsMove {
  return value === "rock" || value === "paper" || value === "scissors";
}

export function isGameLobby(value: unknown): value is GameLobby {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<GameLobby>;
  return (
    typeof row.slug === "string" &&
    typeof row.host_user_id === "string" &&
    typeof row.host_handle === "string" &&
    (row.guest_user_id === null || typeof row.guest_user_id === "string") &&
    (row.guest_handle === null || typeof row.guest_handle === "string") &&
    typeof row.host_has_played === "boolean" &&
    typeof row.guest_has_played === "boolean" &&
    (row.host_move === null || isRpsMove(row.host_move)) &&
    (row.guest_move === null || isRpsMove(row.guest_move)) &&
    (row.winner === null || row.winner === "host" || row.winner === "guest" || row.winner === "draw") &&
    (row.status === "open" ||
      row.status === "ready" ||
      row.status === "playing" ||
      row.status === "complete")
  );
}
