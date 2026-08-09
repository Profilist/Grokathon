import { Suspense, lazy } from "react";
import { GameCard, type PreviewMode } from "./GameCard";
import { GameSetupCard } from "./GameSetupCard";
import { useGameListing } from "./useGameListing";
import type { GameType } from "../../src/games/catalog";

const MahjongCard = lazy(() =>
  import("./MahjongCard").then((module) => ({ default: module.MahjongCard })),
);

type Props = {
  gameId: string;
  hostHandle: string;
  initialGameType: GameType;
  preview: PreviewMode | null;
  theme: "light" | "dark";
  viewerHandle: string | null;
};

export function GameRouter({
  gameId,
  hostHandle,
  initialGameType,
  preview,
  theme,
  viewerHandle,
}: Props) {
  const listingState = useGameListing({
    enabled: preview === null,
    gameId,
    hostHandle,
    viewerHandle,
  });

  if (preview !== null && initialGameType !== "mahjong") {
    return (
      <GameCard
        gameId={gameId}
        hostHandle={hostHandle}
        preview={preview}
        theme={theme}
        viewerHandle={viewerHandle}
        wagerCents={5000}
      />
    );
  }

  const listing = listingState.listing;
  const showMahjong =
    initialGameType === "mahjong" || listing?.game_type === "mahjong";

  if (showMahjong && (listing?.game_type === "mahjong" || preview !== null || listingState.status === "unconfigured")) {
    return (
      <Suspense fallback={<main className="page" data-theme={theme} />}>
        <MahjongCard
          gameId={gameId}
          hostHandle={hostHandle}
          theme={theme}
          viewerHandle={viewerHandle}
          wagerCents={listing?.wager_cents ?? 2000}
        />
      </Suspense>
    );
  }

  if (!listing) {
    return (
      <GameSetupCard
        gameId={gameId}
        hostHandle={hostHandle}
        initialGameType={initialGameType}
        state={listingState}
        theme={theme}
      />
    );
  }

  if (listing.game_type === "rps") {
    return (
      <GameCard
        gameId={gameId}
        hostHandle={hostHandle}
        preview={null}
        theme={theme}
        viewerHandle={viewerHandle}
        wagerCents={listing.wager_cents}
      />
    );
  }

  return (
    <GameSetupCard
      gameId={gameId}
      hostHandle={hostHandle}
      initialGameType={initialGameType}
      state={{ ...listingState, error: "Poker is not playable in this demo.", status: "error" }}
      theme={theme}
    />
  );
}
