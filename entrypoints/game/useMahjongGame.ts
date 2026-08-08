import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { fallbackPlayerHandle, handlesMatch } from "../../src/lobby";
import {
  isMahjongPlayerView,
  type LegalAction,
  type MahjongPlayerView,
} from "../../src/mahjong/types";
import {
  ensureAnonymousUser,
  getSupabaseClient,
  hasSupabaseConfig,
} from "../../src/supabase";

export type MahjongConnectionStatus =
  | "loading"
  | "waiting_for_host"
  | "connected"
  | "unconfigured"
  | "error";

type Options = {
  gameId: string;
  hostHandle: string;
  viewerHandle: string | null;
};

export type MahjongGameState = {
  status: MahjongConnectionStatus;
  view: MahjongPlayerView | null;
  error: string | null;
  busy: string | null;
  isRealtimeConnected: boolean;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  start: () => Promise<void>;
  act: (action: LegalAction) => Promise<void>;
  retry: () => void;
};

export function useMahjongGame({ gameId, hostHandle, viewerHandle }: Options): MahjongGameState {
  const [status, setStatus] = useState<MahjongConnectionStatus>("loading");
  const [view, setView] = useState<MahjongPlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [isRealtimeConnected, setRealtimeConnected] = useState(false);
  const refreshRef = useRef<(() => Promise<void>) | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
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
    let tickTimer: number | null = null;

    const applyView = (nextView: MahjongPlayerView) => {
      if (disposed) return;
      setView(nextView);
      setStatus("connected");
      setError(null);
      if (tickTimer !== null) window.clearTimeout(tickTimer);
      if (nextView.game.deadline_at) {
        const serverOffset = Date.now() - Date.parse(nextView.serverNow);
        const delay = Math.max(50, Date.parse(nextView.game.deadline_at) + serverOffset - Date.now() + 120);
        tickTimer = window.setTimeout(() => {
          void mutate("tick", nextView.game.state_version, undefined, nextView);
        }, delay);
      }
    };

    const invoke = async (body: Record<string, unknown>): Promise<MahjongPlayerView> => {
      const { data, error: functionError } = await supabase.functions.invoke("mahjong-game", { body });
      if (functionError) throw await normalizeFunctionError(functionError);
      if (!isMahjongPlayerView(data)) throw new Error("Mahjong server returned an invalid player view.");
      return data;
    };

    const refresh = async () => {
      try {
        const nextView = await invoke({ operation: "view", gameId });
        applyView(nextView);
      } catch (cause) {
        const message = friendlyError(cause);
        if (/not found/i.test(message)) {
          if (handlesMatch(hostHandle, viewerHandle)) {
            const user = await ensureAnonymousUser(supabase);
            const created = await invoke({
              operation: "create",
              gameId,
              handle: viewerHandle ?? hostHandle,
              idempotencyKey: stableCreateKey(gameId, user.id),
            });
            applyView(created);
          } else if (!disposed) {
            setView(null);
            setStatus("waiting_for_host");
            setError(null);
          }
          return;
        }
        if (!disposed) {
          setError(message);
          setStatus("error");
        }
      }
    };

    const scheduleRefresh = () => {
      if (refreshTimerRef.current !== null) return;
      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        void refresh();
      }, 70);
    };

    const mutate = async (
      operation: "tick",
      expectedVersion: number,
      action: LegalAction | undefined,
      fallbackView: MahjongPlayerView,
    ) => {
      try {
        const nextView = await invoke({
          operation,
          gameId,
          expectedVersion,
          idempotencyKey: crypto.randomUUID(),
          ...(action ? { action } : {}),
        });
        applyView(nextView);
      } catch (cause) {
        if (/state changed/i.test(friendlyError(cause))) await refresh();
        else if (!disposed) {
          setView(fallbackView);
          setError(friendlyError(cause));
        }
      }
    };

    refreshRef.current = refresh;

    const start = async () => {
      setStatus("loading");
      setError(null);
      try {
        await ensureAnonymousUser(supabase);
        if (disposed) return;
        channel = supabase
          .channel(`mahjong-${gameId}-${crypto.randomUUID()}`)
          .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "mahjong_games",
            filter: `slug=eq.${gameId}`,
          }, scheduleRefresh)
          .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "mahjong_seats",
            filter: `game_slug=eq.${gameId}`,
          }, scheduleRefresh)
          .on("postgres_changes", {
            event: "INSERT",
            schema: "public",
            table: "mahjong_events",
            filter: `game_slug=eq.${gameId}`,
          }, scheduleRefresh)
          .subscribe((subscriptionStatus) => {
            if (!disposed) setRealtimeConnected(subscriptionStatus === "SUBSCRIBED");
          });
        await refresh();
      } catch (cause) {
        if (!disposed) {
          setError(friendlyError(cause));
          setStatus("error");
        }
      }
    };

    void start();
    return () => {
      disposed = true;
      refreshRef.current = null;
      setRealtimeConnected(false);
      if (tickTimer !== null) window.clearTimeout(tickTimer);
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (channel) void supabase.removeChannel(channel);
    };
  }, [attempt, gameId, hostHandle, viewerHandle]);

  const runMutation = useCallback(async (
    operation: "join" | "leave" | "start" | "act",
    action?: LegalAction,
  ) => {
    const supabase = getSupabaseClient();
    if (!supabase || !view || busy) return;
    setBusy(operation);
    setError(null);
    try {
      const user = await ensureAnonymousUser(supabase);
      const { data, error: functionError } = await supabase.functions.invoke("mahjong-game", {
        body: {
          operation,
          gameId,
          expectedVersion: view.game.state_version,
          idempotencyKey: crypto.randomUUID(),
          ...(operation === "join"
            ? { handle: viewerHandle ?? fallbackPlayerHandle(user.id) }
            : {}),
          ...(action ? { action } : {}),
        },
      });
      if (functionError) throw await normalizeFunctionError(functionError);
      if (!isMahjongPlayerView(data)) throw new Error("Mahjong server returned an invalid player view.");
      setView(data);
      setStatus("connected");
    } catch (cause) {
      const message = friendlyError(cause);
      setError(message);
      if (/state changed/i.test(message)) await refreshRef.current?.();
    } finally {
      setBusy(null);
    }
  }, [busy, gameId, view, viewerHandle]);

  return useMemo(() => ({
    status,
    view,
    error,
    busy,
    isRealtimeConnected,
    join: () => runMutation("join"),
    leave: () => runMutation("leave"),
    start: () => runMutation("start"),
    act: (action: LegalAction) => runMutation("act", action),
    retry,
  }), [busy, error, isRealtimeConnected, retry, runMutation, status, view]);
}

async function normalizeFunctionError(error: unknown): Promise<Error> {
  if (error && typeof error === "object" && "context" in error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      const body = await response.clone().json().catch(() => null) as { error?: unknown } | null;
      if (typeof body?.error === "string") return new Error(body.error);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return "Enable anonymous sign-ins in Supabase Auth settings.";
  }
  if (/function.*not found|failed to send/i.test(message)) {
    return "Deploy the mahjong-game Edge Function before opening this table.";
  }
  return message;
}

function stableCreateKey(gameId: string, userId: string): string {
  return `create:${gameId}:${userId}`;
}
