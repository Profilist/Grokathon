/**
 * Display-only stakes shared by the play and spectate cards so the two can
 * never drift. No money is moved anywhere in this prototype.
 */
export const WAGER_STAKE_USD = 50;
export const WAGER_POT_USD = WAGER_STAKE_USD * 2;

export const GAME_TITLE = "Rock Paper Scissors";

export function formatUsd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}
