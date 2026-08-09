import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  canJoinLobby,
  fallbackPlayerHandle,
  getLobbyRole,
  getPlayerHasPlayed,
  handlesMatch,
  isGameLobby,
  isRpsMove,
  type GameLobby,
  type LobbyRole,
  type RpsMove,
} from "../../src/lobby";
import {
  ensureAnonymousUser,
  getSupabaseClient,
  hasSupabaseConfig,
} from "../../src/supabase";

export type LobbyStatus =
  | "loading"
  | "unconfigured"
  | "waiting_for_host"
  | "open"
  | "ready"
  | "playing"
  | "complete"
  | "error";

interface UseGameLobbyOptions {
  /**
   * Opens a lobby when the author views their own marked post.
   */
  createIfMissing?: boolean;
  enabled: boolean;
  gameId: string;
  hostHandle: string;
  viewerHandle: string | null;
  wagerCents?: number;
}

export interface GameLobbyState {
  canJoin: boolean;
  canReplay: boolean;
  canSubmitMove: boolean;
  error: string | null;
  isJoining: boolean;
  isReplaying: boolean;
  isSubmittingMove: boolean;
  isRealtimeConnected: boolean;
  join: () => Promise<void>;
  lobby: GameLobby | null;
  myMove: RpsMove | null;
  replay: () => Promise<void>;
  retry: () => void;
  role: LobbyRole;
  status: LobbyStatus;
  submitMove: (move: RpsMove, assetId?: string | null) => Promise<void>;
  userId: string | null;
}

function normalizeLobby(value: unknown): GameLobby | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return isGameLobby(candidate) ? candidate : null;
}

async function fetchLobby(supabase: SupabaseClient, gameId: string): Promise<GameLobby | null> {
  const { data, error } = await supabase
    .from("games")
    .select("*")
    .eq("slug", gameId)
    .maybeSingle();
  if (error) throw error;
  return normalizeLobby(data);
}

async function fetchOwnMove(
  supabase: SupabaseClient,
  gameId: string,
  userId: string,
): Promise<RpsMove | null> {
  const { data, error } = await supabase
    .from("rps_moves")
    .select("choice")
    .eq("game_slug", gameId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return isRpsMove(data?.choice) ? data.choice : null;
}

async function createHostLobby(
  supabase: SupabaseClient,
  gameId: string,
  hostHandle: string,
  wagerCents: number,
): Promise<GameLobby> {
  const { data, error } = await supabase
    .rpc("open_game", {
      p_game_slug: gameId,
      p_game_type: "rps",
      p_wager_cents: wagerCents,
      p_handle: hostHandle.replace(/^@/, ""),
    });

  if (!error) {
    const lobby = normalizeLobby(data);
    if (lobby) return lobby;
  }

  throw error ?? new Error("Supabase returned an invalid lobby");
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return "Enable anonymous sign-ins in Supabase Auth settings.";
  }
  if (/relation.*rps_moves.*does not exist/i.test(message)) {
    return "Run the RPS round migration in Supabase.";
  }
  if (/relation.*games.*does not exist/i.test(message)) {
    return "Run the included Supabase migration before opening a lobby.";
  }
  return message;
}

export function useGameLobby({
  createIfMissing = true,
  enabled,
  gameId,
  hostHandle,
  viewerHandle,
  wagerCents = 500,
}: UseGameLobbyOptions): GameLobbyState {
  const [lobby, setLobby] = useState<GameLobby | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<LobbyStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  const [isSubmittingMove, setIsSubmittingMove] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [myMove, setMyMove] = useState<RpsMove | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) return;
    if (!hasSupabaseConfig()) {
      setStatus("unconfigured");
      return;
    }

    const supabase = getSupabaseClient();
    if (!supabase) {
      setStatus("unconfigured");
      return;
    }

    let disposed = false;
    let channel: RealtimeChannel | null = null;

    const start = async () => {
      setError(null);
      setStatus("loading");
      setMyMove(null);

      try {
        const user = await ensureAnonymousUser(supabase);
        if (disposed) return;
        setUserId(user.id);

        channel = supabase
          .channel(`game-${gameId}-${crypto.randomUUID()}`)
          .on(
            "postgres_changes",
            {
              event: "*",
              schema: "public",
              table: "games",
              filter: `slug=eq.${gameId}`,
            },
            (payload) => {
              if (disposed) return;
              const nextLobby = normalizeLobby(payload.new);
              if (nextLobby) {
                setLobby(nextLobby);
                setStatus(nextLobby.status);
                if (!nextLobby.host_has_played && !nextLobby.guest_has_played) {
                  setMyMove(null);
                }
              }
            },
          )
          .subscribe((subscriptionStatus) => {
            if (disposed) return;
            setIsRealtimeConnected(subscriptionStatus === "SUBSCRIBED");
          });

        let currentLobby = await fetchLobby(supabase, gameId);
        if (!currentLobby && createIfMissing && handlesMatch(hostHandle, viewerHandle)) {
          currentLobby = await createHostLobby(supabase, gameId, hostHandle, wagerCents);
        }
        if (disposed) return;

        setLobby(currentLobby);
        setStatus(currentLobby?.status ?? "waiting_for_host");
        const ownMove = await fetchOwnMove(supabase, gameId, user.id);
        if (!disposed) setMyMove(ownMove);
      } catch (cause) {
        if (disposed) return;
        setError(friendlyError(cause));
        setStatus("error");
      }
    };

    void start();

    return () => {
      disposed = true;
      setIsRealtimeConnected(false);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [attempt, createIfMissing, enabled, gameId, hostHandle, viewerHandle, wagerCents]);

  const role = useMemo(() => getLobbyRole(lobby, userId), [lobby, userId]);
  const canJoin = useMemo(() => canJoinLobby(lobby, userId), [lobby, userId]);
  const canReplay = Boolean(
    lobby &&
      lobby.status === "complete" &&
      (role === "host" || role === "guest"),
  );
  const canSubmitMove = useMemo(
    () =>
      Boolean(
        lobby &&
          (role === "host" || role === "guest") &&
          (lobby.status === "ready" || lobby.status === "playing") &&
          !getPlayerHasPlayed(lobby, role),
      ),
    [lobby, role],
  );

  const join = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !userId || !lobby || !canJoin || isJoining) return;

    setIsJoining(true);
    setError(null);

    try {
      const guestHandle = viewerHandle?.replace(/^@/, "") ?? fallbackPlayerHandle(userId);
      const { data, error: joinError } = await supabase.rpc("join_game", {
        p_game_slug: lobby.slug,
        p_handle: guestHandle,
      });
      if (joinError) throw joinError;

      const joinedLobby = normalizeLobby(data);
      if (!joinedLobby) throw new Error("Supabase returned an invalid joined lobby");
      setLobby(joinedLobby);
      setStatus(joinedLobby.status);
    } catch (cause) {
      setError(friendlyError(cause));
      const currentLobby = await fetchLobby(supabase, lobby.slug).catch(() => null);
      if (currentLobby) {
        setLobby(currentLobby);
        setStatus(currentLobby.status);
      }
    } finally {
      setIsJoining(false);
    }
  }, [canJoin, isJoining, lobby, userId, viewerHandle]);

  const submitMove = useCallback(
    async (move: RpsMove, assetId: string | null = null) => {
      const supabase = getSupabaseClient();
      if (
        !supabase ||
        !userId ||
        !lobby ||
        !canSubmitMove ||
        isSubmittingMove
      ) {
        return;
      }

      setIsSubmittingMove(true);
      setError(null);

      try {
        const { data, error: moveError } = await supabase
          .from("rps_moves")
          .insert({
            game_slug: lobby.slug,
            user_id: userId,
            choice: move,
            asset_id: assetId,
          })
          .select("choice")
          .single();
        if (moveError) throw moveError;
        if (!isRpsMove(data.choice)) throw new Error("Supabase returned an invalid move");

        setMyMove(data.choice);
        const currentLobby = await fetchLobby(supabase, lobby.slug);
        if (currentLobby) {
          setLobby(currentLobby);
          setStatus(currentLobby.status);
        }
      } catch (cause) {
        if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
          setMyMove(await fetchOwnMove(supabase, lobby.slug, userId));
        } else {
          setError(friendlyError(cause));
        }
      } finally {
        setIsSubmittingMove(false);
      }
    },
    [canSubmitMove, isSubmittingMove, lobby, userId],
  );

  const replay = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !lobby || !canReplay || isReplaying) return;

    setIsReplaying(true);
    setError(null);

    try {
      const { data, error: replayError } = await supabase.rpc("reset_rps_round", {
        p_game_slug: lobby.slug,
      });
      if (replayError) throw replayError;

      const resetLobby = normalizeLobby(data);
      if (!resetLobby) throw new Error("Supabase returned an invalid reset lobby");
      setLobby(resetLobby);
      setStatus(resetLobby.status);
      setMyMove(null);
    } catch (cause) {
      setError(friendlyError(cause));
      const currentLobby = await fetchLobby(supabase, lobby.slug).catch(() => null);
      if (currentLobby) {
        setLobby(currentLobby);
        setStatus(currentLobby.status);
        if (!currentLobby.host_has_played && !currentLobby.guest_has_played) {
          setMyMove(null);
        }
      }
    } finally {
      setIsReplaying(false);
    }
  }, [canReplay, isReplaying, lobby]);

  return {
    canJoin,
    canReplay,
    canSubmitMove,
    error,
    isJoining,
    isReplaying,
    isSubmittingMove,
    isRealtimeConnected,
    join,
    lobby,
    myMove,
    replay,
    retry,
    role,
    status,
    submitMove,
    userId,
  };
}
