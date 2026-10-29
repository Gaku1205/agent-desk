const FACTORY_TITLE = /^新サービス[：:]/;

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
