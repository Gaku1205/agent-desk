const FACTORY_TITLE = /^新サービス[：:]/;

/** タイトルが `新サービス：`（全角コロン）か `新サービス:`（半角コロン）で始まるか（開閉・テンプレートかは見ない） */
export function isFactoryTitle(title: string): boolean {
  return FACTORY_TITLE.test(title);
}

/**
 * テンプレートリポジトリの「新サービス：」のIssue（開いている物）か。
 * テンプレート側の工場が受け持つので、「あなたの番」には出さない。
 * `isTemplate` が不明（undefined）のときは、今までどおり false
 */
export function isFactoryIssue(
  title: string,
  isTemplate: boolean | undefined,
  state: "open" | "closed" = "open",
): boolean {
  return isTemplate === true && state === "open" && FACTORY_TITLE.test(title);
}
