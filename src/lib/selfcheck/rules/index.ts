import type { SelfcheckRule } from "../types";
import { aiWorking } from "./aiWorking";
import { allSections } from "./allSections";
import { slotsCount } from "./slotsCount";
import { unreadableHidden } from "./unreadableHidden";
import { yourTurnCount } from "./yourTurnCount";

/** 決まりの一覧。足すときは、1ファイル1決まりで作って、ここに並べる */
export const SELFCHECK_RULES: readonly SelfcheckRule[] = [
  allSections,
  slotsCount,
  yourTurnCount,
  aiWorking,
  unreadableHidden,
];
