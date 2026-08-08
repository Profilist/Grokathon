import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { LegalAction } from "../_shared/mahjong/sim/actions.ts";
import type { PlayerId } from "../_shared/mahjong/sim/state.ts";
import {
  advanceExpiredState,
  applyPlayerAction,
  createMultiplayerRound,
  legalActionsForPlayer,
  redactRoundForPlayer,
  sanitizeEvents,
  type MultiplayerMahjongState,
} from "../_shared/mahjong/multiplayer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type MahjongOperation = "create" | "join" | "leave" | "start" | "view" | "act" | "tick";

type RequestBody = {
  operation?: MahjongOperation;
  gameId?: string;
  handle?: string;
  expectedVersion?: number;
  idempotencyKey?: string;
  action?: unknown;
};

type GameRow = {
  slug: string;
  status: "open" | "ready" | "playing" | "claiming" | "complete";
  round_number: number;
  dealer: PlayerId | null;
  current_player: PlayerId | null;
  deadline_at: string | null;
  state_version: number;
  wall_count: number | null;
  winners: PlayerId[] | null;
  result: unknown;
  last_event_sequence: number;
  created_at: string;
  updated_at: string;
};

type SeatRow = {
  game_slug: string;
  seat: PlayerId;
  user_id: string;
  handle: string;
  joined_at: string;
};

type LoadedGame = {
  game: GameRow;
  seats: SeatRow[];
  state: MultiplayerMahjongState | null;
};

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { user, admin } = await authenticatedClients(request);
    const body = (await request.json()) as RequestBody;
    const operation = parseOperation(body.operation);
    const gameId = parseGameId(body.gameId);

    if (operation === "create") {
      await callRpc(admin, "mahjong_create_game", {
        p_game_slug: gameId,
        p_user_id: user.id,
        p_handle: parseHandle(body.handle),
        p_idempotency_key: parseIdempotencyKey(body.idempotencyKey),
      });
      return json(await loadPlayerView(admin, gameId, user.id));
    }

    if (operation === "view") {
      return json(await loadPlayerView(admin, gameId, user.id));
    }

    const expectedVersion = parseExpectedVersion(body.expectedVersion);
    const idempotencyKey = parseIdempotencyKey(body.idempotencyKey);

    if (operation === "join") {
      await callRpc(admin, "mahjong_join_game", {
        p_game_slug: gameId,
        p_user_id: user.id,
        p_handle: parseHandle(body.handle),
        p_idempotency_key: idempotencyKey,
        p_expected_version: expectedVersion,
      });
      return json(await loadPlayerView(admin, gameId, user.id));
    }

    if (operation === "leave") {
      await callRpc(admin, "mahjong_leave_game", {
        p_game_slug: gameId,
        p_user_id: user.id,
        p_idempotency_key: idempotencyKey,
        p_expected_version: expectedVersion,
      });
      return json(await loadPlayerView(admin, gameId, user.id));
    }

    const loaded = await loadGame(admin, gameId);
    if (loaded.game.state_version !== expectedVersion) {
      throw new HttpError(409, "Mahjong state changed; refresh and retry.");
    }

    if (operation === "start") {
      const seat = seatForUser(loaded.seats, user.id);
      if (seat === null) throw new HttpError(403, "Only seated players can start the hand.");
      if (loaded.seats.length !== 4) throw new HttpError(409, "Four players are required to start.");
      if (loaded.game.status === "playing" || loaded.game.status === "claiming") {
        throw new HttpError(409, "A Mahjong hand is already in progress.");
      }

      const nextState = createMultiplayerRound(crypto.randomUUID());
      await commitTransition({
        admin,
        game: loaded.game,
        userId: user.id,
        idempotencyKey,
        operation,
        nextState,
        previousEventCount: 0,
        roundNumber: loaded.game.round_number + 1,
        seats: loaded.seats,
      });
      return json(await loadPlayerView(admin, gameId, user.id));
    }

    if (!loaded.state) throw new HttpError(409, "Start the Mahjong hand first.");

    let nextState: MultiplayerMahjongState;
    if (operation === "act") {
      const seat = seatForUser(loaded.seats, user.id);
      if (seat === null) throw new HttpError(403, "Only seated players can act.");
      nextState = applyPlayerAction(loaded.state, seat, parseAction(body.action));
    } else if (operation === "tick") {
      const advanced = advanceExpiredState(loaded.state);
      if (!advanced.advanced) return json(buildPlayerView(loaded, user.id));
      nextState = advanced.state;
    } else {
      throw new HttpError(400, "Unsupported Mahjong operation.");
    }

    await commitTransition({
      admin,
      game: loaded.game,
      userId: user.id,
      idempotencyKey,
      operation,
      nextState,
      previousEventCount: loaded.state.events.length,
      roundNumber: loaded.game.round_number,
      seats: loaded.seats,
    });
    return json(await loadPlayerView(admin, gameId, user.id));
  } catch (error) {
    const status = error instanceof HttpError ? error.status : conflictStatus(error);
    const message = error instanceof Error ? error.message : "Unexpected Mahjong server error";
    console.error(JSON.stringify({ status, message }));
    return json({ error: message }, status);
  }
});

async function authenticatedClients(request: Request): Promise<{
  user: User;
  admin: SupabaseClient;
}> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Authentication required.");

  const url = requiredEnv("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ?? requiredEnv("SUPABASE_PUBLISHABLE_KEY");
  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Invalid or expired session.");

  const admin = createClient(url, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: data.user, admin };
}

async function loadGame(admin: SupabaseClient, gameId: string): Promise<LoadedGame> {
  const data = await callRpc(admin, "mahjong_load_game", { p_game_slug: gameId });
  if (!data || typeof data !== "object") throw new HttpError(404, "Mahjong game not found.");
  return data as LoadedGame;
}

async function loadPlayerView(
  admin: SupabaseClient,
  gameId: string,
  userId: string,
): Promise<Record<string, unknown>> {
  return buildPlayerView(await loadGame(admin, gameId), userId);
}

function buildPlayerView(loaded: LoadedGame, userId: string): Record<string, unknown> {
  const seat = seatForUser(loaded.seats, userId);
  const state = loaded.state;
  const canJoin =
    seat === null &&
    loaded.seats.length < 4 &&
    !["playing", "claiming"].includes(loaded.game.status);
  const canStart =
    seat !== null &&
    loaded.seats.length === 4 &&
    !["playing", "claiming"].includes(loaded.game.status);

  return {
    game: loaded.game,
    seats: loaded.seats.map(({ user_id: _userId, ...publicSeat }) => publicSeat),
    seat,
    canJoin,
    canStart,
    round: state ? redactRoundForPlayer(state, seat) : null,
    legalActions: state && seat !== null ? legalActionsForPlayer(state, seat) : [],
    recentEvents: state ? sanitizeEvents(state.events.slice(-12)) : [],
    serverNow: new Date().toISOString(),
  };
}

async function commitTransition({
  admin,
  game,
  userId,
  idempotencyKey,
  operation,
  nextState,
  previousEventCount,
  roundNumber,
  seats,
}: {
  admin: SupabaseClient;
  game: GameRow;
  userId: string;
  idempotencyKey: string;
  operation: MahjongOperation;
  nextState: MultiplayerMahjongState;
  previousEventCount: number;
  roundNumber: number;
  seats: SeatRow[];
}): Promise<void> {
  const projection = {
    status:
      nextState.phase === "complete"
        ? "complete"
        : nextState.phase === "claiming"
          ? "claiming"
          : "playing",
    roundNumber,
    dealer: nextState.round.dealer,
    currentPlayer: nextState.round.currentPlayer,
    deadlineAt: nextState.deadlineAt,
    wallCount: nextState.round.wall.length,
    winners: nextState.round.winners ?? null,
    result:
      nextState.phase === "complete"
        ? {
            outcome: nextState.round.winners?.length ? "win" : "draw",
            winners: nextState.round.winners ?? [],
            players: nextState.round.players,
            seats: seats.map(({ user_id: _userId, ...seat }) => seat),
          }
        : null,
  };
  const events = sanitizeEvents(nextState.events.slice(previousEventCount));
  await callRpc(admin, "mahjong_commit_transition", {
    p_game_slug: game.slug,
    p_user_id: userId,
    p_idempotency_key: idempotencyKey,
    p_operation: operation,
    p_expected_version: game.state_version,
    p_next_state: nextState,
    p_projection: projection,
    p_events: events,
  });
}

async function callRpc(
  admin: SupabaseClient,
  name: string,
  parameters: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await admin.rpc(name, parameters);
  if (error) throw new Error(error.message);
  return data;
}

function seatForUser(seats: SeatRow[], userId: string): PlayerId | null {
  return seats.find((seat) => seat.user_id === userId)?.seat ?? null;
}

function parseOperation(value: unknown): MahjongOperation {
  if (
    value === "create" ||
    value === "join" ||
    value === "leave" ||
    value === "start" ||
    value === "view" ||
    value === "act" ||
    value === "tick"
  ) return value;
  throw new HttpError(400, "A valid Mahjong operation is required.");
}

function parseGameId(value: unknown): string {
  if (typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) {
    return value;
  }
  throw new HttpError(400, "A valid Mahjong game ID is required.");
}

function parseHandle(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "A player handle is required.");
  const handle = value.trim().replace(/^@/, "").slice(0, 32);
  if (!handle) throw new HttpError(400, "A player handle is required.");
  return handle;
}

function parseExpectedVersion(value: unknown): number {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return value;
  throw new HttpError(400, "An expected Mahjong state version is required.");
}

function parseIdempotencyKey(value: unknown): string {
  if (typeof value === "string" && value.length >= 8 && value.length <= 128) return value;
  throw new HttpError(400, "A valid idempotency key is required.");
}

function parseAction(value: unknown): LegalAction {
  if (!value || typeof value !== "object") throw new HttpError(400, "A Mahjong action is required.");
  const action = value as Record<string, unknown>;
  if (action.type === "pass") return { type: "pass" };
  if (action.type === "discard" && typeof action.tileId === "string") {
    return { type: "discard", tileId: action.tileId };
  }
  if (
    action.type === "claim" &&
    (action.claim === "chow" || action.claim === "pong" || action.claim === "kong" || action.claim === "win") &&
    typeof action.tileId === "string"
  ) {
    const consumed = Array.isArray(action.consumedTileIds) ? action.consumedTileIds : undefined;
    if (consumed && (consumed.length !== 2 || consumed.some((id) => typeof id !== "string"))) {
      throw new HttpError(400, "Invalid chow tiles.");
    }
    return {
      type: "claim",
      claim: action.claim,
      tileId: action.tileId,
      ...(consumed ? { consumedTileIds: consumed as [string, string] } : {}),
    };
  }
  if (action.type === "declareKong" && action.kong === "concealed" && Array.isArray(action.tileIds)) {
    if (action.tileIds.length !== 4 || action.tileIds.some((id) => typeof id !== "string")) {
      throw new HttpError(400, "Invalid concealed kong tiles.");
    }
    return { type: "declareKong", kong: "concealed", tileIds: action.tileIds as [string, string, string, string] };
  }
  if (
    action.type === "declareKong" &&
    action.kong === "added" &&
    Number.isInteger(action.meldIndex) &&
    typeof action.tileId === "string"
  ) {
    return { type: "declareKong", kong: "added", meldIndex: action.meldIndex as number, tileId: action.tileId };
  }
  throw new HttpError(400, "Invalid Mahjong action.");
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function conflictStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : String(error);
  return /state changed|already|full|progress|four players|not found|unavailable/i.test(message)
    ? 409
    : 500;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
