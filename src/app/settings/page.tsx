import { Header } from "@/components/Header";
import { MotionSetting } from "@/components/MotionSetting";

export default function SettingsPage() {
  return (
    <>
      <Header kind="settings" />
      <main className="content settings">
        <section className="settings-section" aria-labelledby="settings-repos">
          <h2 id="settings-repos" className="settings-title">
            監視するリポジトリ
          </h2>
        </section>
        <section className="settings-section" aria-labelledby="settings-notify">
          <h2 id="settings-notify" className="settings-title">
            通知
          </h2>
        </section>
        <section className="settings-section" aria-labelledby="settings-motion">
          <h2 id="settings-motion" className="settings-title">
            動き
          </h2>
          <MotionSetting />
        </section>
      </main>
    </>
  );
}
