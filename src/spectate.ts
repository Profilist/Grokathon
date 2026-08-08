/** Newest messages kept in memory for a spectate session. */
export const MESSAGE_HISTORY_LIMIT = 100;
export const MESSAGE_BODY_LIMIT = 280;

export interface SpectatorMessage {
  id: number;
  game_slug: string;
  user_id: string;
  handle: string;
  body: string;
  created_at: string;
}

export interface Spectator {
  userId: string;
  handle: string;
}

export function isSpectatorMessage(value: unknown): value is SpectatorMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<SpectatorMessage>;
  return (
    typeof row.id === "number" &&
    typeof row.game_slug === "string" &&
    typeof row.user_id === "string" &&
    typeof row.handle === "string" &&
    typeof row.body === "string" &&
    typeof row.created_at === "string"
  );
}

/**
 * Folds realtime inserts into the local history. Realtime can redeliver a row
 * that the initial fetch already returned, so dedupe by primary key and keep
 * the list ordered oldest first for rendering.
 */
export function mergeMessages(
  existing: SpectatorMessage[],
  incoming: SpectatorMessage[],
): SpectatorMessage[] {
  const byId = new Map<number, SpectatorMessage>();
  for (const message of [...existing, ...incoming]) {
    byId.set(message.id, message);
  }

  return Array.from(byId.values())
    .sort((left, right) =>
      left.created_at === right.created_at
        ? left.id - right.id
        : left.created_at < right.created_at
          ? -1
          : 1,
    )
    .slice(-MESSAGE_HISTORY_LIMIT);
}

/**
 * Flattens a Supabase Presence state into a stable spectator roster. A single
 * viewer can hold several presence refs (reconnects, multiple tabs), so
 * collapse them by user id.
 */
export function spectatorsFromPresence(
  state: Record<string, unknown[]>,
): Spectator[] {
  const byUserId = new Map<string, Spectator>();

  for (const presences of Object.values(state)) {
    for (const presence of presences) {
      if (!presence || typeof presence !== "object") continue;
      const { userId, handle } = presence as Partial<Spectator>;
      if (typeof userId !== "string" || typeof handle !== "string") continue;
      if (!byUserId.has(userId)) byUserId.set(userId, { userId, handle });
    }
  }

  return Array.from(byUserId.values()).sort((left, right) =>
    left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0,
  );
}

/**
 * Deterministic hue so a handle keeps the same colour across cards and
 * sessions. Mixes over the full 32-bit range before reducing to a hue,
 * otherwise short handles cluster into the same corner of the wheel.
 */
export function avatarHue(handle: string): number {
  let hash = 2166136261;
  const normalized = handle.replace(/^@/, "").toLowerCase();

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Math.abs(hash ^ (hash >>> 15)) % 360;
}

export function avatarInitial(handle: string): string {
  return handle.replace(/^@/, "").slice(0, 1).toUpperCase() || "?";
}

export function formatRelativeTime(iso: string, now: number): string {
  const elapsed = now - Date.parse(iso);
  if (!Number.isFinite(elapsed)) return "";

  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  if (seconds < 5) return "now";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  return `${Math.floor(hours / 24)}d`;
}
