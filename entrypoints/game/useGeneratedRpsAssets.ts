import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { buildFreeformAsset, disposeFreeformAsset } from "../../src/freeformAssetProgram";
import {
  parseGeneratedAssetJob,
  parseRenderableRpsAsset,
  parseRevealedRpsAssets,
  type GeneratedAssetStatus,
  type RenderableRpsAsset,
} from "../../src/generatedRpsAssets";
import type { RpsMove } from "../../src/lobby";
import { getSupabaseClient } from "../../src/supabase";

type GenerationState = "idle" | GeneratedAssetStatus | "loading";

interface UseGeneratedRpsAssetsOptions {
  enabled: boolean;
  gameId: string;
  roundComplete: boolean;
  userId: string | null;
}

interface GeneratedRpsAssetsState {
  error: string | null;
  generate: (move: RpsMove, prompt: string) => Promise<void>;
  generatingMove: RpsMove | null;
  generationState: GenerationState;
  guestResultAsset: RenderableRpsAsset | null;
  hostResultAsset: RenderableRpsAsset | null;
  selectionAssets: Partial<Record<RpsMove, RenderableRpsAsset>>;
}

const JOB_TIMEOUT_MS = 150_000;

function functionError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function readableFunctionError(error: unknown): Promise<Error> {
  if (error && typeof error === "object" && "context" in error) {
    const context = error.context;
    if (context instanceof Response) {
      const payload = (await context.clone().json().catch(() => null)) as { error?: unknown } | null;
      if (typeof payload?.error === "string") return new Error(payload.error);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function fetchOwnedAsset(
  supabase: SupabaseClient,
  assetId: string,
): Promise<RenderableRpsAsset> {
  const { data, error } = await supabase.functions.invoke("rps-assets", {
    body: { operation: "asset", assetId },
  });
  if (error) throw await readableFunctionError(error);
  if (!data || typeof data !== "object" || !("asset" in data)) {
    throw new Error("Asset service returned an invalid response");
  }
  return parseRenderableRpsAsset(data.asset);
}

async function waitForAsset(
  supabase: SupabaseClient,
  assetId: string,
): Promise<"ready" | "failed"> {
  let channel: RealtimeChannel | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;

  try {
    return await new Promise<"ready" | "failed">((resolve, reject) => {
      let settled = false;
      const settle = (result: "ready" | "failed") => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      const checkCurrent = async () => {
        const { data, error } = await supabase
          .from("generated_assets")
          .select("status,error_code")
          .eq("id", assetId)
          .maybeSingle();
        if (error) throw error;
        if (data?.status === "ready" || data?.status === "failed") settle(data.status);
      };

      timeout = setTimeout(() => {
        if (!settled) reject(new Error("Asset generation took too long. Try a simpler prompt."));
      }, JOB_TIMEOUT_MS);

      channel = supabase
        .channel(`generated-asset-${assetId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "generated_assets",
            filter: `id=eq.${assetId}`,
          },
          (payload) => {
            const status = (payload.new as { status?: unknown }).status;
            if (status === "ready" || status === "failed") settle(status);
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            void checkCurrent().catch(reject);
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            reject(new Error("Lost the live asset-generation connection"));
          }
        });
    });
  } finally {
    if (timeout) clearTimeout(timeout);
    if (channel) await supabase.removeChannel(channel);
  }
}

export function useGeneratedRpsAssets({
  enabled,
  gameId,
  roundComplete,
  userId,
}: UseGeneratedRpsAssetsOptions): GeneratedRpsAssetsState {
  const [selectionAssets, setSelectionAssets] = useState<
    Partial<Record<RpsMove, RenderableRpsAsset>>
  >({});
  const [hostResultAsset, setHostResultAsset] = useState<RenderableRpsAsset | null>(null);
  const [guestResultAsset, setGuestResultAsset] = useState<RenderableRpsAsset | null>(null);
  const [generationState, setGenerationState] = useState<GenerationState>("idle");
  const [generatingMove, setGeneratingMove] = useState<RpsMove | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const wasComplete = useRef(roundComplete);

  useEffect(() => {
    requestVersion.current += 1;
    setSelectionAssets({});
    setHostResultAsset(null);
    setGuestResultAsset(null);
    setGenerationState("idle");
    setGeneratingMove(null);
    setError(null);
  }, [gameId]);

  useEffect(() => {
    if (wasComplete.current && !roundComplete) {
      requestVersion.current += 1;
      setSelectionAssets({});
      setHostResultAsset(null);
      setGuestResultAsset(null);
      setGenerationState("idle");
      setGeneratingMove(null);
      setError(null);
    }
    wasComplete.current = roundComplete;
  }, [roundComplete]);

  useEffect(() => {
    if (!enabled || !roundComplete || !userId) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let disposed = false;

    void (async () => {
      const { data, error: revealError } = await supabase.functions.invoke("rps-assets", {
        body: { operation: "revealed", gameId },
      });
      if (revealError) throw await readableFunctionError(revealError);
      const revealed = parseRevealedRpsAssets(data);
      if (!disposed) {
        setHostResultAsset(revealed.host);
        setGuestResultAsset(revealed.guest);
      }
    })().catch((cause) => {
      if (!disposed) setError(functionError(cause));
    });

    return () => {
      disposed = true;
    };
  }, [enabled, gameId, roundComplete, userId]);

  const generate = useCallback(
    async (move: RpsMove, prompt: string) => {
      const normalizedPrompt = prompt.trim();
      if (!enabled || !userId || !normalizedPrompt) return;
      const supabase = getSupabaseClient();
      if (!supabase) {
        setError("Supabase is not configured");
        return;
      }

      const version = ++requestVersion.current;
      setGeneratingMove(move);
      setGenerationState("generating");
      setError(null);

      try {
        const { data, error: invokeError } = await supabase.functions.invoke("rps-assets", {
          body: { operation: "generate", gameId, move, prompt: normalizedPrompt },
        });
        if (invokeError) throw await readableFunctionError(invokeError);
        const job = parseGeneratedAssetJob(data);
        const status = job.status === "generating" ? await waitForAsset(supabase, job.assetId) : job.status;
        if (version !== requestVersion.current) return;
        if (status === "failed") throw new Error("Grok could not build that asset. Try a more visual prompt.");

        setGenerationState("loading");
        const asset = await fetchOwnedAsset(supabase, job.assetId);
        if (version !== requestVersion.current) return;
        const checked = buildFreeformAsset(asset.program);
        disposeFreeformAsset(checked.group);
        setSelectionAssets((current) => ({ ...current, [move]: asset }));
        setGenerationState("ready");
      } catch (cause) {
        if (version !== requestVersion.current) return;
        setGenerationState("failed");
        setError(functionError(cause));
      } finally {
        if (version === requestVersion.current) setGeneratingMove(null);
      }
    },
    [enabled, gameId, userId],
  );

  return {
    error,
    generate,
    generatingMove,
    generationState,
    guestResultAsset,
    hostResultAsset,
    selectionAssets,
  };
}
