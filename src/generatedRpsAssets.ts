import {
  validateFreeformAssetProgram,
  type FreeformAssetProgram,
} from "./freeformAssetSchema";
import { isRpsMove, type RpsMove } from "./lobby";

export type GeneratedAssetStatus = "generating" | "ready" | "failed";

export interface RenderableRpsAsset {
  id: string;
  move: RpsMove;
  name: string;
  program: FreeformAssetProgram;
  textureUrl: string | null;
}

export interface GeneratedAssetJob {
  assetId: string;
  status: GeneratedAssetStatus;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

export function parseGeneratedAssetJob(value: unknown): GeneratedAssetJob {
  if (!isRecord(value) || !isUuid(value.assetId)) {
    throw new Error("Asset generator returned an invalid job");
  }
  if (value.status !== "generating" && value.status !== "ready" && value.status !== "failed") {
    throw new Error("Asset generator returned an invalid status");
  }
  return { assetId: value.assetId, status: value.status };
}

export function parseRenderableRpsAsset(value: unknown): RenderableRpsAsset {
  if (!isRecord(value) || !isUuid(value.id) || !isRpsMove(value.move)) {
    throw new Error("Generated asset response is invalid");
  }
  const program = validateFreeformAssetProgram(value.program);
  if (program.move !== value.move) {
    throw new Error("Generated asset does not match its RPS move");
  }
  if (value.textureUrl !== null && typeof value.textureUrl !== "string") {
    throw new Error("Generated asset texture URL is invalid");
  }
  return {
    id: value.id,
    move: value.move,
    name: typeof value.name === "string" && value.name ? value.name : program.name,
    program,
    textureUrl: value.textureUrl,
  };
}

export function parseRevealedRpsAssets(value: unknown): {
  host: RenderableRpsAsset | null;
  guest: RenderableRpsAsset | null;
} {
  if (!isRecord(value)) throw new Error("Revealed asset response is invalid");
  return {
    host: value.host === null ? null : parseRenderableRpsAsset(value.host),
    guest: value.guest === null ? null : parseRenderableRpsAsset(value.guest),
  };
}

export function parseLatestRpsAssets(
  value: unknown,
): Partial<Record<RpsMove, RenderableRpsAsset>> {
  if (!isRecord(value) || !isRecord(value.assets)) {
    throw new Error("Latest asset response is invalid");
  }

  const assets: Partial<Record<RpsMove, RenderableRpsAsset>> = {};
  for (const move of ["rock", "paper", "scissors"] as const) {
    const candidate = value.assets[move];
    if (candidate === null || candidate === undefined) continue;
    const asset = parseRenderableRpsAsset(candidate);
    if (asset.move !== move) {
      throw new Error("Latest asset does not match its RPS move");
    }
    assets[move] = asset;
  }
  return assets;
}
