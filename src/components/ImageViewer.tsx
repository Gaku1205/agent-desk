"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { sameDeviceIndex, stepIndex, viewerKeyDelta, type ViewerSlide } from "@/lib/imageViewer";
import { ChevronLeftIcon, ChevronRightIcon, CrossIcon } from "./icons";
import styles from "./ImageViewer.module.css";

type Props = {
  slides: ViewerSlide[];
  /** 見ている案の位置と、その中の画像の位置 */
  slide: number;
  image: number;
  onChange: (slide: number, image: number) => void;
  onClose: () => void;
  /** 開くとき押した画像（閉じたらここへフォーカスを戻す） */
  opener: HTMLElement | null;
};

const DEVICE_LABEL = { pc: "PC", mobile: "スマホ" } as const;

/**
 * 画像の全体表示（docs/design.md の「画像の全体表示」）。画面いっぱいの暗い背景に画像と、案の記号・題名の1行。
 * Esc・外を押すと閉じ、← → で同じ段階の次・前の案へ（端で止まる）。開いている間は、ほかの画面のキー操作を効かせない
 */
export function ImageViewer({ slides, slide, image, onChange, onClose, opener }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const latest = useRef({ slides, slide, image, onChange, onClose });
  useEffect(() => {
    latest.current = { slides, slide, image, onChange, onClose };
  });

  const current = slides[slide];
  const shown = current?.images[image] ?? current?.images[0];

  function go(delta: number) {
    const { slides: list, slide: at, image: img, onChange: change } = latest.current;
    const next = stepIndex(at, delta, list.length);
    if (next === at) return;
    change(next, sameDeviceIndex(list[next].images, list[at]?.images[img]?.device));
  }

  useEffect(() => {
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      // 後ろの受け手（`?` の一覧・メニューの Esc・ラジオの矢印）へ渡さない
      event.stopPropagation();
      if (event.key === "Escape") {
        latest.current.onClose();
      } else if (event.key === "Tab") {
        // 一覧の中の押せる物だけを回る
        event.preventDefault();
        const buttons = Array.from(dialogRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
        if (buttons.length === 0) return;
        const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = (at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[next].focus();
      } else {
        const delta = viewerKeyDelta(event.key);
        if (delta !== 0) {
          event.preventDefault();
          go(delta);
        }
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  if (!current || !shown) return null;

  // 暗い背景（と、画像・ボタンの外の空き）を押したら閉じる
  function onScrimClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target as HTMLElement).closest("[data-keep]")) onClose();
  }

  const atStart = slide === 0;
  const atEnd = slide === slides.length - 1;

  return createPortal(
    <div className={styles.scrim} onClick={onScrimClick}>
      <div ref={dialogRef} className={styles.dialog} role="dialog" aria-modal="true" aria-label="画像の全体表示">
        <div className={styles.head}>
          <p className={styles.caption} data-keep>
            {current.mark && <span className={styles.letter}>{current.mark}</span>}
            <span className={styles.title}>{current.title}</span>
            {current.images.length > 1 &&
              current.images.map((item, i) => (
                <button
                  key={item.src}
                  type="button"
                  className={styles.device}
                  aria-pressed={i === image}
                  onClick={() => onChange(slide, i)}
                >
                  {DEVICE_LABEL[item.device]}
                </button>
              ))}
          </p>
          <button type="button" ref={closeRef} className={styles.iconBtn} aria-label="閉じる" onClick={onClose} data-keep>
            <CrossIcon size={18} />
          </button>
        </div>
        <div className={styles.stage}>
          {/* 工場のコメントの画像のURLをそのまま出す（外のサイトの画像なので next/image は使わない） */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={shown.src} alt={shown.alt} className={styles.img} referrerPolicy="no-referrer" data-keep />
        </div>
        <div className={styles.nav}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="前の案"
            aria-disabled={atStart}
            onClick={() => go(-1)}
            data-keep
          >
            <ChevronLeftIcon size={18} />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="次の案"
            aria-disabled={atEnd}
            onClick={() => go(1)}
            data-keep
          >
            <ChevronRightIcon size={18} />
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
