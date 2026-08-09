import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import {
  FREEFORM_ASSET_PROGRAM_JSON_SCHEMA,
  type FreeformAssetProgram,
  type FreeformMove,
  validateFreeformAssetProgram,
} from "../../../src/freeformAssetSchema.ts";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const XAI_API_ROOT = "https://api.x.ai/v1";
const TEXT_MODEL = "grok-4.5";
const TEXTURE_MODEL = "grok-imagine-image";
const ASSET_BUCKET = "rps-generated-assets";
const SIGNED_URL_SECONDS = 15 * 60;
const MAX_PROGRAM_ATTEMPTS = 1;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SYSTEM_PROMPT =
  `You author a universal constrained 3D asset program for a trusted SDF/CSG compiler. Return only a version 3 program matching the supplied schema.

The requested Rock, Paper, or Scissors move is a gameplay class, not a required literal object. Preserve the requested move field exactly while creating the user's visual concept.

Choose surfaceDetailMode by what carries the visual identity:
- texture: painted colors, repeating patterns, panels, labels, scales, or other detail that does not change the silhouette. Use exactly one connected geometry part. Never model painted patches as floating geometry. A ball or globe should use one sphere source. texturePrompt must describe the complete equirectangular surface map.
- decal: only a few thin, surface-attached markings. Each decal is an extrude attached with a surface parent anchor and a front/back self anchor.
- geometry: real structures that change the silhouette, such as blades, handles, horns, wings, limbs, crystals, holes, or articulated pieces.

Build coherent shapes with a flat node graph inside each material part:
- Primitives: sphere, box, capsule, torus, cylinder, cone.
- Freeform: sweep, extrude, lathe.
- CSG: union, smoothUnion, subtract, intersect.
- Modifiers: twist, bend, noise.
- Every part must be one connected solid. CSG inputs must overlap.
- Exactly one root part has parentPartId "". Other parts attach to an earlier semantic part.
- Every attachment offset, rotation, scale, and anchor direction is exactly three JSON numbers. Root attachment offset and rotation are [0,0,0] with scale [1,1,1]. Keep attachment offsets between -2 and 2 and anchor direction components between -3 and 3. Always write decimal points; never split 0.6 into 0,6.
- Keep a recognizable silhouette with 1-6 parts and 1-8 nodes per part.
- Y is up and the thumbnail camera looks from +Z.
- Use resolution 20-24 and keep coordinates roughly within -1.5 to 1.5.
- Use texture/decal detail instead of thin floating boxes.

All schema fields are required. For fields ignored by an operation use neutral values: inputs [], position/rotation [0,0,0], scale/size [1,1,1], radius 0.5, radiusTop 0.2, radiusBottom 0.5, tube 0.1, height 1, roundness 0.05, smoothness 0.12, amount 0.1, frequency 5, and points/radii/polygon/profile []. Do not write code, raw vertices, base64, text labels, trademarks, or external file references.`;

type RequestBody = {
  operation?: "generate" | "asset" | "revealed";
  gameId?: unknown;
  move?: unknown;
  prompt?: unknown;
  assetId?: unknown;
};

type GeneratedAssetRow = {
  id: string;
  owner_user_id: string;
  game_slug: string;
  move: FreeformMove;
  status: "generating" | "ready" | "failed";
  program: unknown;
  texture_path: string | null;
};

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await request.json()) as RequestBody;
    const operation = parseOperation(body.operation);
    const { user, admin } = await authenticatedClients(request);

    if (operation === "generate") {
      const gameId = parseGameId(body.gameId);
      const move = parseMove(body.move);
      const prompt = parsePrompt(body.prompt);
      await requireOpenSeat(admin, gameId, user.id);
      await requireGenerationBudget(admin, user.id);

      const { data, error } = await admin
        .from("generated_assets")
        .insert({ owner_user_id: user.id, game_slug: gameId, move })
        .select("id")
        .single();
      if (error) throw error;
      const assetId = String(data.id);

      EdgeRuntime.waitUntil(generateAsset({ admin, assetId, move, prompt }));
      return json({ assetId, status: "generating" }, 202);
    }

    if (operation === "asset") {
      const assetId = parseUuid(body.assetId, "asset ID");
      const asset = await loadAsset(admin, assetId);
      await requireAssetAccess(admin, asset, user.id);
      return json({ asset: await renderableAsset(admin, asset) });
    }

    const gameId = parseGameId(body.gameId);
    const { data: round, error: roundError } = await admin
      .from("rps_rounds")
      .select("seat_0_asset_id,seat_1_asset_id,resolved_at")
      .eq("game_slug", gameId)
      .maybeSingle();
    if (roundError) throw roundError;
    if (!round?.resolved_at) {
      throw new HttpError(409, "This round has not revealed its assets yet.");
    }

    const [host, guest] = await Promise.all([
      round.seat_0_asset_id
        ? renderableAsset(admin, await loadAsset(admin, round.seat_0_asset_id))
        : null,
      round.seat_1_asset_id
        ? renderableAsset(admin, await loadAsset(admin, round.seat_1_asset_id))
        : null,
    ]);
    return json({ host, guest });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const message = error instanceof Error
      ? error.message
      : "Unexpected generated asset error";
    console.error(JSON.stringify({ status, message }));
    return json({
      error: status === 500 ? "Generated asset service failed" : message,
    }, status);
  }
});

async function generateAsset({
  admin,
  assetId,
  move,
  prompt,
}: {
  admin: SupabaseClient;
  assetId: string;
  move: FreeformMove;
  prompt: string;
}) {
  try {
    const program = await generateProgram(prompt, move);
    let texturePath: string | null = null;
    if (program.surfaceDetailMode !== "geometry") {
      const texture = await generateTexture(program);
      texturePath = `${assetId}/texture${texture.extension}`;
      const { error: uploadError } = await admin.storage
        .from(ASSET_BUCKET)
        .upload(texturePath, texture.bytes, {
          contentType: texture.mimeType,
          upsert: false,
        });
      if (uploadError) throw uploadError;
    }

    const { error } = await admin
      .from("generated_assets")
      .update({
        status: "ready",
        program,
        texture_path: texturePath,
        updated_at: new Date().toISOString(),
      })
      .eq("id", assetId)
      .eq("status", "generating");
    if (error) throw error;
  } catch (error) {
    console.error(
      JSON.stringify({
        assetId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    const { error: updateError } = await admin
      .from("generated_assets")
      .update({
        status: "failed",
        error_code: "generation_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", assetId)
      .eq("status", "generating");
    if (updateError) {
      console.error(
        JSON.stringify({ assetId, updateError: updateError.message }),
      );
    }
  }
}

async function generateProgram(
  prompt: string,
  move: FreeformMove,
): Promise<FreeformAssetProgram> {
  let previousFailure = "";
  for (let attempt = 1; attempt <= MAX_PROGRAM_ATTEMPTS; attempt += 1) {
    const response = await xaiRequest<{
      output?: Array<
        { type?: string; content?: Array<{ type?: string; text?: string }> }
      >;
    }>("/responses", {
      model: TEXT_MODEL,
      store: false,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            `Gameplay move: ${move}`,
            `Asset request: ${prompt}`,
            previousFailure
              ? `Previous validation failure: ${previousFailure}. Correct it.`
              : "",
          ].filter(Boolean).join("\n"),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "freeform_asset_program",
          schema: FREEFORM_ASSET_PROGRAM_JSON_SCHEMA,
          strict: true,
        },
      },
    }, 120_000);

    try {
      const program = validateFreeformAssetProgram(
        JSON.parse(extractResponseText(response)),
      );
      if (program.move !== move) {
        throw new Error(`Program move must remain ${move}`);
      }
      return program;
    } catch (error) {
      previousFailure = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    `Grok did not return a valid asset program: ${previousFailure}`,
  );
}

async function generateTexture(program: FreeformAssetProgram) {
  const prompt = [
    program.surfaceDetailMode === "texture"
      ? "Complete equirectangular spherical UV albedo map. Fill the whole image. Left and right edges join seamlessly."
      : "Seamless square tileable albedo material for a stylized low-poly game prop.",
    program.texturePrompt,
    "Edge-to-edge texture only. No isolated object, lighting, shadow, perspective, words, logos, border, or frame.",
  ].join(" ");
  const response = await xaiRequest<{
    data?: Array<{ b64_json?: string; base64?: string; url?: string }>;
  }>("/images/generations", {
    model: TEXTURE_MODEL,
    prompt,
    n: 1,
    response_format: "url",
  }, 50_000);
  const image = response.data?.[0];
  if (!image) throw new Error("Imagine returned no texture");
  const encoded = image.b64_json ?? image.base64;
  if (encoded) {
    return {
      bytes: Uint8Array.from(
        atob(encoded),
        (character) => character.charCodeAt(0),
      ),
      extension: ".png",
      mimeType: "image/png",
    };
  }
  if (!image.url) throw new Error("Imagine returned no texture URL");
  const downloaded = await fetch(image.url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!downloaded.ok) {
    throw new Error(`Texture download failed (${downloaded.status})`);
  }
  const mimeType = normalizedImageMime(downloaded.headers.get("content-type"));
  return {
    bytes: new Uint8Array(await downloaded.arrayBuffer()),
    extension: mimeType === "image/png"
      ? ".png"
      : mimeType === "image/webp"
      ? ".webp"
      : ".jpg",
    mimeType,
  };
}

async function xaiRequest<T>(
  path: string,
  body: unknown,
  timeoutMs: number,
): Promise<T> {
  const response = await fetch(`${XAI_API_ROOT}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("XAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!response.ok) {
    throw new Error(
      `xAI request failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }
  return payload as T;
}

function extractResponseText(response: {
  output?: Array<
    { type?: string; content?: Array<{ type?: string; text?: string }> }
  >;
}) {
  for (const item of response.output ?? []) {
    if (item.type !== "message") continue;
    const text = item.content?.find(({ type }) => type === "output_text")?.text;
    if (text) return text;
  }
  throw new Error("Grok returned no structured program");
}

async function authenticatedClients(
  request: Request,
): Promise<{ user: User; admin: SupabaseClient }> {
  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HttpError(401, "Authentication required.");
  }

  const url = requiredEnv("SUPABASE_URL");
  const publishableKey = Deno.env.get("SUPABASE_ANON_KEY") ??
    requiredEnv("SUPABASE_PUBLISHABLE_KEY");
  const userClient = createClient(url, publishableKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) {
    throw new HttpError(401, "Invalid or expired session.");
  }

  const admin = createClient(url, requiredEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { user: data.user, admin };
}

async function requireOpenSeat(
  admin: SupabaseClient,
  gameId: string,
  userId: string,
) {
  const { data: game, error: gameError } = await admin
    .from("games")
    .select("game_type,status")
    .eq("slug", gameId)
    .maybeSingle();
  if (gameError) throw gameError;
  if (
    !game || game.game_type !== "rps" ||
    !["ready", "playing"].includes(game.status)
  ) {
    throw new HttpError(409, "This RPS round is not accepting assets.");
  }
  const { data: seat, error: seatError } = await admin
    .from("game_players")
    .select("seat")
    .eq("game_slug", gameId)
    .eq("user_id", userId)
    .maybeSingle();
  if (seatError) throw seatError;
  if (!seat) {
    throw new HttpError(403, "Only seated players can generate an asset.");
  }
}

async function requireGenerationBudget(admin: SupabaseClient, userId: string) {
  const since = new Date(Date.now() - 60_000).toISOString();
  const { data, error } = await admin
    .from("generated_assets")
    .select("id,status")
    .eq("owner_user_id", userId)
    .gte("created_at", since);
  if (error) throw error;
  if (data.some(({ status }) => status === "generating")) {
    throw new HttpError(
      409,
      "Finish the current asset before generating another.",
    );
  }
  if (data.length >= 3) {
    throw new HttpError(429, "You can generate three assets per minute.");
  }
}

async function requireAssetAccess(
  admin: SupabaseClient,
  asset: GeneratedAssetRow,
  userId: string,
) {
  if (asset.owner_user_id === userId) return;
  const { data, error } = await admin
    .from("rps_rounds")
    .select("game_slug")
    .not("resolved_at", "is", null)
    .or(`seat_0_asset_id.eq.${asset.id},seat_1_asset_id.eq.${asset.id}`)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new HttpError(403, "This generated asset has not been revealed.");
  }
}

async function loadAsset(
  admin: SupabaseClient,
  assetId: string,
): Promise<GeneratedAssetRow> {
  const { data, error } = await admin
    .from("generated_assets")
    .select("id,owner_user_id,game_slug,move,status,program,texture_path")
    .eq("id", assetId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, "Generated asset not found.");
  if (data.status !== "ready") {
    throw new HttpError(409, "Generated asset is not ready.");
  }
  return data as GeneratedAssetRow;
}

async function renderableAsset(
  admin: SupabaseClient,
  asset: GeneratedAssetRow,
) {
  const program = validateFreeformAssetProgram(asset.program);
  let textureUrl: string | null = null;
  if (asset.texture_path) {
    const { data, error } = await admin.storage
      .from(ASSET_BUCKET)
      .createSignedUrl(asset.texture_path, SIGNED_URL_SECONDS);
    if (error) throw error;
    textureUrl = data.signedUrl;
  }
  return {
    id: asset.id,
    move: asset.move,
    name: program.name,
    program,
    textureUrl,
  };
}

function parseOperation(value: unknown): "generate" | "asset" | "revealed" {
  if (value === "generate" || value === "asset" || value === "revealed") {
    return value;
  }
  throw new HttpError(400, "Unsupported asset operation.");
}

function parseGameId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) {
    throw new HttpError(400, "Invalid game ID.");
  }
  return value;
}

function parseMove(value: unknown): FreeformMove {
  if (value === "rock" || value === "paper" || value === "scissors") {
    return value;
  }
  throw new HttpError(400, "Choose rock, paper, or scissors.");
}

function parsePrompt(value: unknown): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Describe the asset to generate.");
  }
  const prompt = value.trim();
  if (prompt.length < 4 || prompt.length > 280) {
    throw new HttpError(400, "Asset prompts must contain 4-280 characters.");
  }
  return prompt;
}

function parseUuid(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(value)
  ) {
    throw new HttpError(400, `Invalid ${label}.`);
  }
  return value;
}

function normalizedImageMime(
  value: string | null,
): "image/jpeg" | "image/png" | "image/webp" {
  if (value?.includes("png")) return "image/png";
  if (value?.includes("webp")) return "image/webp";
  return "image/jpeg";
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
