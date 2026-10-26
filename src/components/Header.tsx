import { MenuButton } from "./MenuButton";

type Props =
  | { kind: "home" }
  | { kind: "settings" }
  | { kind: "repo"; owner: string; repo: string };

export function Header(props: Props) {
  return (
    <header className="header">
      <div className="header-lead">
        <MenuButton />
        {props.kind === "home" ? (
          <h1 className="header-title">ホーム</h1>
        ) : props.kind === "settings" ? (
          <h1 className="header-title">設定</h1>
        ) : (
          <h1 className="header-repo mono">
            <span className="header-repo-owner">{props.owner}</span>
            <span className="header-repo-slash"> / </span>
            <span className="header-repo-name">{props.repo}</span>
          </h1>
        )}
      </div>
      {props.kind === "repo" && (
        <a
          className="header-link"
          href={`https://github.com/${props.owner}/${props.repo}`}
          target="_blank"
          rel="noreferrer"
        >
          GitHubで開く ↗
        </a>
      )}
    </header>
  );
}
