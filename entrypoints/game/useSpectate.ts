import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { fallbackPlayerHandle } from "../../src/lobby";
import {
  MESSAGE_BODY_LIMIT,
  isSpectatorMessage,
  mergeMessages,
  spectatorsFromPresence,
  type Spectator,
  type SpectatorMessage,
} from "../../src/spectate";
import {
  ensureAnonymousUser,
  getSupabaseClient,
  hasSupabaseConfig,
} from "../../src/supabase";

/** Client-side floor between messages. There is no server-side rate limit. */
const SEND_INTERVAL_MS = 750;
const INITIAL_MESSAGE_LIMIT = 50;

export type SpectateStatus = "loading" | "unconfigured" | "ready" | "error";

interface UseSpectateOptions {
  enabled: boolean;
  gameId: string;
  viewerHandle: string | null;
}

export interface SpectateState {
  error: string | null;
  handle: string | null;
  isRealtimeConnected: boolean;
  isSending: boolean;
  isSpectating: boolean;
  messages: SpectatorMessage[];
  retry: () => void;
  sendMessage: (body: string) => Promise<void>;
  spectatorCount: number;
  spectators: Spectator[];
  startSpectating: () => void;
  status: SpectateStatus;
  stopSpectating: () => void;
  userId: string | null;
}

async function fetchRecentMessages(
  supabase: SupabaseClient,
  gameId: string,
): Promise<SpectatorMessage[]> {
  const { data, error } = await supabase
    .from("spectator_messages")
    .select("*")
    .eq("game_slug", gameId)
    .order("created_at", { ascending: false })
    .limit(INITIAL_MESSAGE_LIMIT);

  if (error) throw error;
  return (data ?? []).filter(isSpectatorMessage).reverse();
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/anonymous sign-ins are disabled/i.test(message)) {
    return "Enable anonymous sign-ins in Supabase Auth settings.";
  }
  if (/relation.*spectator_messages.*does not exist/i.test(message)) {
    return "Run the spectator chat migration in Supabase.";
  }
  return message;
}

export function useSpectate({
  enabled,
  gameId,
  viewerHandle,
}: UseSpectateOptions): SpectateState {
  const [messages, setMessages] = useState<SpectatorMessage[]>([]);
  const [spectators, setSpectators] = useState<Spectator[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [status, setStatus] = useState<SpectateStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isSpectating, setIsSpectating] = useState(false);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastSentAtRef = useRef(0);

  const handle = useMemo(() => {
    if (viewerHandle) return viewerHandle.replace(/^@/, "");
    return userId ? fallbackPlayerHandle(userId) : null;
  }, [userId, viewerHandle]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const startSpectating = useCallback(() => setIsSpectating(true), []);
  const stopSpectating = useCallback(() => setIsSpectating(false), []);

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
      setMessages([]);
      setSpectators([]);

      try {
        const user = await ensureAnonymousUser(supabase);
        if (disposed) return;
        setUserId(user.id);

        // One channel carries both concerns: chat inserts and the audience
        // roster. Presence is keyed by user id so reconnects and extra tabs
        // collapse into a single spectator.
        channel = supabase
          .channel(`spectate-${gameId}`, {
            config: { presence: { key: user.id } },
          })
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "spectator_messages",
              filter: `game_slug=eq.${gameId}`,
            },
            (payload) => {
              if (disposed) return;
              if (!isSpectatorMessage(payload.new)) return;
              const incoming = payload.new;
              setMessages((current) => mergeMessages(current, [incoming]));
            },
          )
          .on("presence", { event: "sync" }, () => {
            if (disposed || !channel) return;
            setSpectators(
              spectatorsFromPresence(
                channel.presenceState() as unknown as Record<string, unknown[]>,
              ),
            );
          })
          .subscribe((subscriptionStatus) => {
            if (disposed) return;
            setIsRealtimeConnected(subscriptionStatus === "SUBSCRIBED");
          });

        channelRef.current = channel;

        const recent = await fetchRecentMessages(supabase, gameId);
        if (disposed) return;

        setMessages((current) => mergeMessages(current, recent));
        setStatus("ready");
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
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [attempt, enabled, gameId]);

  // Watching is opt-in: the summary card subscribes so it can show a live
  // count, but only announces the viewer once they click Spectate.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !isRealtimeConnected || !userId || !handle) return;

    if (!isSpectating) {
      void channel.untrack();
      return;
    }

    void channel.track({ userId, handle });
    return () => {
      void channel.untrack();
    };
  }, [handle, isRealtimeConnected, isSpectating, userId]);

  const sendMessage = useCallback(
    async (body: string) => {
      const supabase = getSupabaseClient();
      const trimmed = body.trim();
      if (!supabase || !userId || !handle || isSending) return;
      if (!trimmed || trimmed.length > MESSAGE_BODY_LIMIT) return;

      const now = Date.now();
      if (now - lastSentAtRef.current < SEND_INTERVAL_MS) return;
      lastSentAtRef.current = now;

      setIsSending(true);
      setError(null);

      try {
        const { data, error: sendError } = await supabase
          .from("spectator_messages")
          .insert({
            game_slug: gameId,
            user_id: userId,
            handle,
            body: trimmed,
          })
          .select("*")
          .single();
        if (sendError) throw sendError;
        if (!isSpectatorMessage(data)) {
          throw new Error("Supabase returned an invalid message");
        }

        // Echo locally so the sender does not wait on the realtime round trip.
        // mergeMessages dedupes when the broadcast arrives.
        const inserted = data;
        setMessages((current) => mergeMessages(current, [inserted]));
      } catch (cause) {
        lastSentAtRef.current = 0;
        setError(friendlyError(cause));
      } finally {
        setIsSending(false);
      }
    },
    [gameId, handle, isSending, userId],
  );

  return {
    error,
    handle,
    isRealtimeConnected,
    isSending,
    isSpectating,
    messages,
    retry,
    sendMessage,
    spectatorCount: spectators.length,
    spectators,
    startSpectating,
    status,
    stopSpectating,
    userId,
  };
}
