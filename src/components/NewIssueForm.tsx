"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createNewIssue, uploadNewIssueImage } from "@/app/actions";
import { ACTION_UNREACHABLE_MESSAGE, callAction } from "@/lib/actionCall";
import { focusAfterRemove, type FocusAfterRemove } from "@/lib/imageFocus";
import { chooseIssueRepo } from "@/lib/issueRepo";
import { IMAGE_ACCEPT, IMAGE_FORM_FIELDS, IMAGE_HEAD_BYTES, isFileDrag, pickAddableImages } from "@/lib/issueImages";
import type { CreateIssueResult, UploadImageResult } from "@/lib/operations";
import {
  checkNewIssueMemo,
  composeNewIssue,
  MAX_NEW_ISSUE_MEMO,
  memoLength,
  NEW_ISSUE_COUNTER_FROM,
  NEW_ISSUE_MESSAGES,
} from "@/lib/newIssue";
import { useDemo } from "./DemoContext";
import { CrossIcon, EnterIcon, FileIcon, ImageIcon, PlusIcon, RepoIcon, WriteIcon } from "./icons";
import { Select } from "./Select";
import { Sheet } from "./Sheet";
import settingsStyles from "./SettingsSections.module.css";
import styles from "./NewIssueForm.module.css";

export type NewIssueRepo = {
  /** `owner/repo` */
  name: string;
  /** テンプレートリポジトリか（「新サービス：」で書く） */
  template: boolean;
};

type Status =
  | { kind: "idle" }
  | { kind: "created"; number: number | null; url: string | null }
  | { kind: "error"; message: string };

type AttachedImage = {
  id: number;
  file: File;
  /** サムネイル用のURL（手元のファイル） */
  url: string;
  /** 上げ終えた先（失敗してもう一度押したとき、同じリポジトリなら上げ直さない） */
  uploaded?: { repo: string; url: string };
};

/** 画像を1枚、ファイルのまま（base64 にせず）サーバーに送る */
async function uploadImage(owner: string, repo: string, file: File): Promise<UploadImageResult> {
  const formData = new FormData();
  formData.set(IMAGE_FORM_FIELDS.owner, owner);
  formData.set(IMAGE_FORM_FIELDS.repo, repo);
  formData.set(IMAGE_FORM_FIELDS.file, file);
  return callAction<UploadImageResult>(
    () => uploadNewIssueImage(formData),
    () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
  );
}

/** メモの囲み：ページでは label、bar では送るボタンが中に入るので div（名前は入力の aria-label） */
function MemoWrap({ as, className, children }: { as: "div" | "label"; className: string; children: ReactNode }) {
  return as === "div" ? <div className={className}>{children}</div> : <label className={className}>{children}</label>;
}

function hasFiles(event: DragEvent): boolean {
  return isFileDrag(event.dataTransfer.types);
}

/**
 * Issueを書く画面（docs/design.md の「Issueを書く」）。作るのはサーバー側（Server Action）。デモでは GitHub に送らない。
 * `bar` は PCの3ペインの中央の下に置く1行の形（見出し・名札なし。docs/design.md の「PCの3ペイン」）
 */
export function NewIssueForm({
  repos,
  initialRepo,
  variant = "page",
  mode = "issue",
  newServiceHref,
}: {
  /** `bar` の補助の行に置く「＋ 新しいサービスを作る」の行き先（`/new/service`。デモは `/demo/new/service`） */
  newServiceHref?: string;
  repos: NewIssueRepo[];
  initialRepo?: string;
  variant?: "page" | "bar";
  /** `service`＝「新しいサービスを作る」（/new/service。送り先はテンプレートリポジトリだけ。渡す repos もテンプレートだけにする） */
  mode?: "issue" | "service";
}) {
  const bar = variant === "bar";
  const service = mode === "service";
  const names = repos.map((repo) => repo.name);
  // 入力欄はページをまたいで残るので、選びは「手で選んだ物と、そのときのページ」だけ覚え、今のページ（initialRepo）と合わせて決める。
  // 別のページへ移ったら手の選びは捨てて、移った先に従う
  const [manual, setManual] = useState<{ name: string; page: string | null } | null>(null);
  const selected = chooseIssueRepo({
    names,
    pageRepo: initialRepo,
    manual: manual?.name,
    manualPage: manual?.page,
  });
  const [title, setTitle] = useState("");
  const [omakase, setOmakase] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const router = useRouter();
  const [saving, startSaving] = useTransition();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [images, setImages] = useState<AttachedImage[]>([]);
  const imagesRef = useRef(images);
  const nextImageId = useRef(1);
  const [imageMessage, setImageMessage] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const demo = useDemo();
  const formRef = useRef<HTMLFormElement>(null);
  const attachRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<FocusAfterRemove | null>(null);

  // 画像を外したあと、再描画が済んでからフォーカスを移す（押したボタンは消えるので）
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    if (target.kind === "attach") attachRef.current?.focus();
    else formRef.current?.querySelectorAll<HTMLButtonElement>("[data-remove-image]")[target.index]?.focus();
  }, [images]);

  const count = memoLength(title);
  const overLimit = count > MAX_NEW_ISSUE_MEMO;
  const blank = title.trim() === "";

  // 打つと高さが伸びる（1行〜8行。超えたら CSS の max-height で止まり、欄の中でスクロール）
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [title]);

  const template = service || repos.find((repo) => repo.name === selected)?.template === true;

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  // 画面を離れるときに、サムネイル用のURLを手放す
  useEffect(() => () => imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url)), []);

  // フォームが出ている間だけ、ウィンドウに落とした画像をブラウザが開かないようにする（開くとページを離れて、書きかけのメモが消えるため）。
  // 入力欄の上の受け口（onDragOver・onDrop）はそのまま。ここはフォームの外と作成中の分。文字などのドラッグには何もしない
  const formShown = names.length > 0;
  useEffect(() => {
    if (!formShown) return;
    const onWindowDrag = (event: globalThis.DragEvent) => {
      if (!event.dataTransfer || !isFileDrag(event.dataTransfer.types)) return;
      event.preventDefault();
    };
    window.addEventListener("dragover", onWindowDrag);
    window.addEventListener("drop", onWindowDrag);
    return () => {
      window.removeEventListener("dragover", onWindowDrag);
      window.removeEventListener("drop", onWindowDrag);
    };
  }, [formShown]);

  /** 画像を足す：中身の先頭で種類を確かめ、種類・大きさ・枚数の決まりを超えたものは足さない */
  async function addImages(files: File[]) {
    if (saving || files.length === 0) return;
    const heads = await Promise.all(
      files.map(async (file) => new Uint8Array(await file.slice(0, IMAGE_HEAD_BYTES).arrayBuffer())),
    );
    const { accepted, message } = pickAddableImages(
      imagesRef.current.length,
      files.map((file, index) => ({ size: file.size, head: heads[index] })),
    );
    setImageMessage(message);
    if (accepted.length === 0) return;
    const added = accepted.map((index) => ({
      id: nextImageId.current++,
      file: files[index],
      url: URL.createObjectURL(files[index]),
    }));
    // 続けて呼ばれても数え間違えないよう、すぐ参照にも入れる
    imagesRef.current = [...imagesRef.current, ...added];
    setImages(imagesRef.current);
  }

  function removeImage(id: number) {
    if (saving) return;
    const removedIndex = imagesRef.current.findIndex((image) => image.id === id);
    const target = imagesRef.current[removedIndex];
    if (target) URL.revokeObjectURL(target.url);
    imagesRef.current = imagesRef.current.filter((image) => image.id !== id);
    setImages(imagesRef.current);
    setImageMessage(null);
    if (removedIndex >= 0) pendingFocus.current = focusAfterRemove(removedIndex, imagesRef.current.length);
  }

  function clearImages() {
    imagesRef.current.forEach((image) => URL.revokeObjectURL(image.url));
    imagesRef.current = [];
    setImages([]);
    setImageMessage(null);
  }

  function onPaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
    if (files.length === 0) return;
    // 文字も一緒にあるときは、文字の貼り付けをそのまま通す
    if (event.clipboardData.getData("text/plain") === "") event.preventDefault();
    void addImages(files);
  }

  function onDragOver(event: DragEvent) {
    if (saving || !hasFiles(event)) return;
    event.preventDefault();
    setDropping(true);
  }

  function onDrop(event: DragEvent) {
    if (!hasFiles(event)) return;
    event.preventDefault();
    setDropping(false);
    void addImages(Array.from(event.dataTransfer.files));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    const checked = checkNewIssueMemo(title);
    if (!checked.ok) {
      setStatus({ kind: "error", message: checked.message });
      inputRef.current?.focus();
      return;
    }
    const [owner, repo] = selected.split("/");
    if (!owner || !repo) return;
    if (demo) {
      // GitHub には送らず、サンプルのデータにIssueを足す
      demo.createIssue({ owner, repo }, composeNewIssue({ memo: checked.memo, isTemplate: template, omakase }));
      // 画像は見せるだけ（デモのIssueには入れない）
      setStatus({ kind: "created", number: null, url: null });
      setTitle("");
      clearImages();
      inputRef.current?.focus();
      return;
    }
    setStatus({ kind: "idle" });
    setImageMessage(null);
    const attached = imagesRef.current;
    startSaving(async () => {
      // 画像を1枚ずつ上げてから、Issueを作る。1枚でも上げられなければ、Issueは作らない（メモと画像は残す）
      const imageUrls: string[] = [];
      for (const image of attached) {
        if (image.uploaded?.repo === selected) {
          imageUrls.push(image.uploaded.url);
          continue;
        }
        const uploaded = await uploadImage(owner, repo, image.file);
        if (!uploaded.ok) {
          setStatus({ kind: "error", message: uploaded.message });
          return;
        }
        image.uploaded = { repo: selected, url: uploaded.url };
        imageUrls.push(uploaded.url);
      }
      // 呼び出しが投げても、画面を落とさず、書いたメモと画像を残して理由を出す
      const result = await callAction<CreateIssueResult>(
        () =>
          createNewIssue({
            owner,
            repo,
            memo: checked.memo,
            omakase: template && omakase,
            images: imageUrls,
          }),
        () => ({ ok: false, message: ACTION_UNREACHABLE_MESSAGE }),
      );
      if (result.ok) {
        setStatus({ kind: "created", number: result.number, url: result.url });
        setTitle("");
        clearImages();
        // できたIssueを出すための取り直しは裏で行う（骨組みに戻さない）
        startTransition(() => router.refresh());
      } else {
        setStatus({ kind: "error", message: result.message });
      }
    });
  }

  /** 下の入力欄だけ：Enter で送る（Shift+Enter は改行。日本語の変換中の Enter は変換の確定なので送らない） */
  function onMemoKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!bar || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (saving || blank || overLimit) return;
    formRef.current?.requestSubmit();
  }

  const memoLabel = service ? "どんなサービスを作りたいか" : template ? "新サービスのメモ" : "メモ";
  const empty = (
    <p className={styles.empty}>
      {service
        ? "監視リストにテンプレートのリポジトリがありません。設定でテンプレートのリポジトリ（ai-dev-template など）を追加すると、ここから新しいサービスを作れます"
        : "監視するリポジトリがありません。設定で追加すると、ここからIssueを書けます"}
    </p>
  );
  const form = (
              <form
                ref={formRef}
                className={bar ? styles.barForm : styles.form}
                onSubmit={submit}
                onDragOver={onDragOver}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
                }}
                onDrop={onDrop}
                data-dropping={dropping ? "" : undefined}
                noValidate
              >
                {service && names.length === 1 ? (
                  <div className={styles.field}>
                    <span className={styles.label}>送り先</span>
                    <span className={styles.target}>
                      <RepoIcon />
                      {selected}
                    </span>
                  </div>
                ) : (
                  <div className={`${styles.field} ${bar ? styles.barRepo : ""}`}>
                    {!bar && (
                      <span className={styles.label} id="new-issue-repo">
                        {service ? "送り先のテンプレート" : "リポジトリ"}
                      </span>
                    )}
                    <Select
                      options={names}
                      value={selected}
                      onChange={(next) => {
                        setManual({ name: next, page: initialRepo ?? null });
                        setStatus({ kind: "idle" });
                      }}
                      label={service ? "送り先のテンプレートリポジトリ" : "Issueを書くリポジトリ"}
                      disabled={saving}
                      icon={<RepoIcon />}
                      plain={bar}
                    />
                  </div>
                )}
                {bar && newServiceHref && (
                  <Link href={newServiceHref} className={styles.barLink}>
                    <PlusIcon size={18} />
                    <span className={styles.hidden}>新しいサービスを作る</span>
                  </Link>
                )}
                <MemoWrap as={bar ? "div" : "label"} className={`${styles.field} ${bar ? styles.barMemo : ""}`}>
                  {!bar && <span className={styles.label}>{memoLabel}</span>}
                  <span className={styles.memo}>
                    {template && <span className={styles.prefix}>新サービス：</span>}
                    <textarea
                      ref={inputRef}
                      className={styles.input}
                      rows={1}
                      aria-label={bar ? memoLabel : undefined}
                      value={title}
                      onChange={(event) => {
                        setTitle(event.target.value);
                        if (status.kind === "error") setStatus({ kind: "idle" });
                      }}
                      onKeyDown={onMemoKeyDown}
                      onPaste={onPaste}
                      autoComplete="off"
                      disabled={saving}
                      aria-invalid={status.kind === "error" || overLimit ? true : undefined}
                      placeholder={template ? "毎朝の天気と予定のページ" : "お問い合わせに自動で返事を送る"}
                    />
                    {count >= NEW_ISSUE_COUNTER_FROM && (
                      <span className={styles.counter} data-over={overLimit ? "" : undefined}>
                        {count.toLocaleString("en-US")} / {MAX_NEW_ISSUE_MEMO.toLocaleString("en-US")}
                      </span>
                    )}
                    {bar && (
                      <button
                        type="submit"
                        className={styles.send}
                        data-ready={!blank && !overLimit ? "" : undefined}
                        disabled={saving || blank || overLimit}
                        aria-busy={saving}
                        aria-label="Issueを作る"
                        title="Issueを作る"
                      >
                        <EnterIcon size={20} />
                      </button>
                    )}
                  </span>
                </MemoWrap>
                {overLimit && (
                  <p className={`${settingsStyles.error} ${styles.imageMessage}`} role="alert">
                    {NEW_ISSUE_MESSAGES.tooLong}
                  </p>
                )}
                {imageMessage && (
                  <p className={`${settingsStyles.error} ${styles.imageMessage}`} role="alert">
                    {imageMessage}
                  </p>
                )}
                {images.length > 0 && (
                  <ul className={styles.thumbs} aria-label="付けた画像">
                    {images.map((image) => (
                      <li key={image.id} className={styles.thumb}>
                        {/* 手元のファイルのプレビュー（最適化できないので <img> のまま） */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image.url} alt="" className={styles.thumbImage} />
                        <button
                          type="button"
                          className={styles.thumbRemove}
                          data-remove-image=""
                          onClick={() => removeImage(image.id)}
                          disabled={saving}
                          aria-label="画像を外す"
                          title="削除"
                        >
                          <CrossIcon />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={IMAGE_ACCEPT}
                  multiple
                  hidden
                  onChange={(event) => {
                    void addImages(Array.from(event.target.files ?? []));
                    // 同じファイルをもう一度選べるように
                    event.target.value = "";
                  }}
                />
                <button
                  ref={attachRef}
                  type="button"
                  className={styles.attach}
                  onClick={() => fileRef.current?.click()}
                  disabled={saving}
                  aria-label="画像を付ける"
                  title="画像を付ける"
                >
                  <ImageIcon size={18} />
                </button>
                {template && (
                  <div className={styles.omakase}>
                    {/* 標準のチェックボックスは見えなくして残し（キーボード・読み上げ）、ランプと字を描く */}
                    <label className={settingsStyles.toggle} data-on={omakase ? "" : undefined}>
                      <input
                        type="checkbox"
                        className={settingsStyles.native}
                        checked={omakase}
                        onChange={() => setOmakase((on) => !on)}
                        disabled={saving}
                        aria-label="全部おまかせ"
                      />
                      <span className={settingsStyles.lamp} aria-hidden="true" />
                      <span aria-hidden="true">全部おまかせ</span>
                    </label>
                    <span className={styles.hint}>
                      {omakase ? "相談せずに、AIが全部決めて作ります" : "選ばなければ、AIが案を出して相談してきます"}
                    </span>
                  </div>
                )}
                <div className={`${settingsStyles.save} ${styles.actions}`}>
                  {!bar && (
                    <button type="submit" className={settingsStyles.button} disabled={saving || overLimit} aria-busy={saving}>
                      {service ? <PlusIcon /> : <WriteIcon />}
                      {saving ? "作成中…" : service ? "サービスを作る" : "Issueを作る"}
                    </button>
                  )}
                  {status.kind === "created" && (
                    <span className={settingsStyles.saved} role="status">
                      {status.number !== null ? `#${status.number} を作りました` : "作りました。あなたの番に出ます"}
                      {status.url && (
                        <>
                          {" "}
                          <a className={styles.link} href={status.url} target="_blank" rel="noreferrer noopener">
                            開く ↗
                          </a>
                        </>
                      )}
                    </span>
                  )}
                  {status.kind === "error" && (
                    <span className={settingsStyles.error} role="alert">
                      {status.message}
                    </span>
                  )}
                </div>
                {service && status.kind === "created" && (
                  <p className={styles.after}>工場が新しいリポジトリを作って、公開まで進めます。相談があれば「あなたの番」に出ます</p>
                )}
              </form>
  );

  if (bar) {
    return (
      <section className={styles.bar} aria-label="Issueを書く">
        <div className={styles.barInner}>{names.length === 0 ? empty : form}</div>
      </section>
    );
  }

  return (
    <Sheet>
      <div className={settingsStyles.page}>
        <h1 className={settingsStyles.h1}>{service ? "新しいサービスを作る" : "Issueを書く"}</h1>
        <div className={settingsStyles.sections}>
          <section className={settingsStyles.section} aria-labelledby="new-issue-title">
            <h2 id="new-issue-title" className={settingsStyles.title}>
              {service ? <PlusIcon /> : <FileIcon />}
              {service ? "どんなサービス？" : "メモ"}
            </h2>
            {service && (
              <p className={styles.lead}>
                新しいリポジトリを工場が作ります。今あるリポジトリに頼むときは、「Issueを書く」から
              </p>
            )}
            {names.length === 0 ? empty : form}
          </section>
        </div>
      </div>
    </Sheet>
  );
}
