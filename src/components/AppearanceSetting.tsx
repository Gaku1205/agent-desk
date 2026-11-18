"use client";

import { useSyncExternalStore } from "react";
import {
  applyMotion,
  getBrowserStorage,
  readMotion,
  writeMotion,
  type MotionSetting as Motion,
} from "@/lib/motion";
import { applyTheme, readTheme, writeTheme, type ThemeSetting as Theme } from "@/lib/theme";
import { Segmented } from "./Segmented";
import { SettingsPanel, SettingsRow } from "./SettingsRow";

const THEME_CHOICES: readonly { value: Theme; label: string }[] = [
  { value: "system", label: "OS" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const MOTION_CHOICES: readonly { value: Motion; label: string }[] = [
  { value: "system", label: "OS" },
  { value: "on", label: "On" },
  { value: "off", label: "Off" },
];

const listeners = new Set<() => void>();
// localStorage が使えないときも、このタブの間は選んだ内容を覚えておく
let themeMemory: Theme | null = null;
let motionMemory: Motion | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function chooseTheme(setting: Theme) {
  themeMemory = setting;
  writeTheme(getBrowserStorage(), setting);
  applyTheme(setting, document.documentElement);
  listeners.forEach((listener) => listener());
}

function chooseMotion(setting: Motion) {
  motionMemory = setting;
  writeMotion(getBrowserStorage(), setting);
  applyMotion(setting, document.documentElement);
  listeners.forEach((listener) => listener());
}

const serverSnapshot = () => "system" as const;

/** 「Appearance」：テーマとアニメーション。そのブラウザに保存し、選んだらすぐ反映する（デモでも本当に保存する） */
export function AppearanceSetting() {
  const theme = useSyncExternalStore(subscribe, () => themeMemory ?? readTheme(getBrowserStorage()), serverSnapshot);
  const motion = useSyncExternalStore(
    subscribe,
    () => motionMemory ?? readMotion(getBrowserStorage()),
    serverSnapshot,
  );

  return (
    <SettingsPanel>
      <SettingsRow name="Theme" description="このブラウザの色">
        <Segmented options={THEME_CHOICES} value={theme} onChange={chooseTheme} label="テーマ" />
      </SettingsRow>
      <SettingsRow name="Motion" description="このブラウザの動き">
        <Segmented options={MOTION_CHOICES} value={motion} onChange={chooseMotion} label="アニメーション" />
      </SettingsRow>
    </SettingsPanel>
  );
}
