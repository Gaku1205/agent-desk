import styles from "./Header.module.css";
import { MenuButton } from "./MenuButton";

type Props =
  | { kind: "home" }
  | { kind: "settings" }
  /** githubLink：右の「GitHubで開く ↗」を出すか（デモの架空のリポジトリでは出さない） */
  | { kind: "repo"; owner: string; repo: string; githubLink?: boolean };

export function Header(props: Props) {
  return (
    <header className={styles.header}>
      <div className={styles.lead}>
        <MenuButton />
        {props.kind === "home" ? (
          <h1 className={styles.title}>ホーム</h1>
        ) : props.kind === "settings" ? (
          <h1 className={styles.title}>設定</h1>
        ) : (
          <h1 className={`${styles.repo} mono`}>
            <span className={styles.repoOwner}>{props.owner}</span>
            <span className={styles.repoSlash}> / </span>
            <span className={styles.repoName}>{props.repo}</span>
          </h1>
        )}
      </div>
      {props.kind === "repo" && props.githubLink !== false && (
        <a
          className={styles.link}
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
