import type { PlayerId } from "./state.ts";
import type { Meld } from "./state.ts";
import type { TileInstance } from "./tiles.ts";

export type DiscardAction = {
  type: "discard";
  tileId: string;
};

export type ClaimAction = {
  type: "claim";
  claim: "chow" | "pong" | "kong" | "win";
  tileId: string;
  consumedTileIds?: [string, string];
};

export type DeclareConcealedKongAction = {
  type: "declareKong";
  kong: "concealed";
  tileIds: [string, string, string, string];
};

export type DeclareAddedKongAction = {
  type: "declareKong";
  kong: "added";
  meldIndex: number;
  tileId: string;
};

export type DeclareKongAction =
  | DeclareConcealedKongAction
  | DeclareAddedKongAction;

export type PassAction = {
  type: "pass";
};

export type LegalAction =
  | DiscardAction
  | ClaimAction
  | DeclareKongAction
  | PassAction;

export type BotContext = {
  player: PlayerId;
  legalActions: LegalAction[];
  visibleTiles: TileInstance[];
  hand: TileInstance[];
  melds: Meld[];
  wallCount: number;
  turn: number;
};
