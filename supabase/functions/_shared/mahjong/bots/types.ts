import type { BotContext, LegalAction } from "../sim/actions.ts";

export type MahjongBot = {
  name: string;
  chooseAction(context: BotContext): LegalAction;
};
