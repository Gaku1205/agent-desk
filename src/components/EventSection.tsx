import {
  formatEventTime,
  groupEventsByDay,
  type EventIcon,
  type EventTone,
  type RecentEvent,
} from "@/lib/events";

type Props = {
  events: RecentEvent[];
  now: Date;
};

const TONE_COLOR: Record<EventTone, string> = {
  human: "var(--human)",
  ai: "var(--ai)",
  deployed: "var(--done)",
  fail: "var(--fail)",
  operation: "var(--text-sub)",
};

const TONE_BG: Record<EventTone, string> = {
  human: "#241b0e",
  ai: "#101b2d",
  deployed: "#0f2219",
  fail: "#2a1213",
  operation: "#17181b",
};

/** docs/design.md の「出来事の一覧」のアイコン（viewBox 24×24、線の太さ 2.2） */
const ICON_PATH: Record<EventIcon, string> = {
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  play: "M7 5l12 7-12 7z",
  pr: "M6 3v12M18 9v12M6 15a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM18 3a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  merge: "M6 3v18M6 9c0 6 12 3 12 9",
  up: "M12 19V5M5 12l7-7 7 7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z",
};

function EventGlyph({ icon, tone }: { icon: EventIcon; tone: EventTone }) {
  return (
    <span className="event-icon" style={{ background: TONE_BG[tone], color: TONE_COLOR[tone] }}>
      <svg
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d={ICON_PATH[icon]} />
      </svg>
    </span>
  );
}

/** 最近の出来事（ホームだけ）：直近3日を日ごとにまとめて、新しい順に出す */
export function EventSection({ events, now }: Props) {
  const days = groupEventsByDay(events, now);
  return (
    <section className="section" aria-labelledby="event-title">
      <div className="section-head">
        <h2 className="section-title" id="event-title">
          最近の出来事
        </h2>
        <span className="section-note">直近3日</span>
      </div>

      {days.length === 0 ? (
        <p className="empty event-empty">直近3日の出来事はありません</p>
      ) : (
        days.map((day) => (
          <div key={day.heading}>
            <h3 className="event-day">{day.heading}</h3>
            <ul className="event-list">
              {day.events.map((event) => (
                <li className="event-row" key={event.id}>
                  <time className="event-time mono" dateTime={event.at}>
                    {formatEventTime(event.at)}
                  </time>
                  <EventGlyph icon={event.icon} tone={event.tone} />
                  <div className="event-body">
                    <div className="event-text">{event.text}</div>
                    <div className="event-ref mono">{event.ref}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
