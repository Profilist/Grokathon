import { useCallback, useEffect, useMemo, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { handlesMatch } from "../../src/lobby";
import type { GameType } from "../../src/games/catalog";
import {
  normalizeGameListing,
  type GameListing,
} from "../../src/games/listing";
import {
  ensureAnonymousUser,
  getSupabaseClient,
  hasSupabaseConfig,
} from "../../src/supabase";

export type GameListingStatus =
  | "loading"
  | "waiting_for_host"
  | "ready"
  | "unconfigured"
  | "error";

type Options = {
  enabled: boolean;
  gameId: string;
  hostHandle: string;
  viewerHandle: string | null;
};

export type GameListingState = {
  canConfigure: boolean;
  createGame: (gameType: GameType, wagerCents: number) => Promise<void>;
  error: string | null;
  isCreating: boolean;
  isRealtimeConnected: boolean;
  listing: GameListing | null;
  retry: () => void;
  status: GameListingStatus;
};

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return "Enable anonymous sign-ins in Supabase Auth settings.";
  }
  if (/relation.*games.*does not exist/i.test(message)) {
    return "Run the included Supabase migrations before creating a game.";
  }
  return message;
}

export function useGameListing({
  enabled,
  gameId,
  hostHandle,
  viewerHandle,
}: Options): GameListingState {
  const [listing, setListing] = useState<GameListing | null>(null);
  const [status, setStatus] = useState<GameListingStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const canConfigure = useMemo(
    () => handlesMatch(hostHandle, viewerHandle),
    [hostHandle, viewerHandle],
  );

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

      try {
        await ensureAnonymousUser(supabase);
        if (disposed) return;

        channel = supabase
          .channel(`game-listing-${gameId}-${crypto.randomUUID()}`)
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
              const nextListing = normalizeGameListing(payload.new);
              if (!nextListing) return;
              setListing(nextListing);
              setStatus("ready");
            },
          )
          .subscribe((subscriptionStatus) => {
            if (disposed) return;
            setIsRealtimeConnected(subscriptionStatus === "SUBSCRIBED");
          });

        const { data, error: loadError } = await supabase
          .from("games")
          .select("*")
          .eq("slug", gameId)
          .maybeSingle();
        if (loadError) throw loadError;

        const currentListing = normalizeGameListing(data);
        if (disposed) return;
        setListing(currentListing);
        setStatus(currentListing ? "ready" : "waiting_for_host");
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
  }, [attempt, enabled, gameId]);

  const createGame = useCallback(
    async (gameType: GameType, wagerCents: number) => {
      const supabase = getSupabaseClient();
      if (!supabase || !canConfigure || isCreating || listing) return;

      setIsCreating(true);
      setError(null);
      try {
        await ensureAnonymousUser(supabase);
        const { data, error: createError } = await supabase.rpc("open_game", {
          p_game_slug: gameId,
          p_game_type: gameType,
          p_wager_cents: wagerCents,
          p_handle: hostHandle.replace(/^@/, ""),
        });
        if (createError) throw createError;

        const created = normalizeGameListing(data);
        if (!created) throw new Error("Supabase returned an invalid game listing");
        setListing(created);
        setStatus("ready");
      } catch (cause) {
        setError(friendlyError(cause));
        setStatus("error");
      } finally {
        setIsCreating(false);
      }
    },
    [canConfigure, gameId, hostHandle, isCreating, listing],
  );

  return {
    canConfigure,
    createGame,
    error,
    isCreating,
    isRealtimeConnected,
    listing,
    retry,
    status,
  };
}
