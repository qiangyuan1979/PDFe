import { useEffect, useRef, useState } from "react";
import { useApp, isDarkTheme, THEME_PRESETS, type ThemePref } from "../state/store";
import { useT } from "../i18n";

const RAIL: { id: "thumbnails" | "bookmarks"; icon: string; labelKey: string }[] = [
  { id: "thumbnails", icon: "▦", labelKey: "页面缩略图" },
  { id: "bookmarks", icon: "🔖", labelKey: "书签" },
];

/** 主题偏好选项：「跟随系统」+ 各固定主题 */
const PREFS: { id: ThemePref; labelKey: string }[] = [
  { id: "system", labelKey: "跟随系统" },
  ...THEME_PRESETS,
];

/** 强调色快捷选项 */
const ACCENTS = ["#0067c0", "#0f9d58", "#9a6b2f", "#c42b1c", "#7c4dff", "#00838f"];

export default function Rail() {
  const leftTab = useApp((s) => s.leftTab);
  const leftVisible = useApp((s) => s.leftVisible);
  const setLeftTab = useApp((s) => s.setLeftTab);
  const toggleLeft = useApp((s) => s.toggleLeft);
  const theme = useApp((s) => s.theme);
  const themePref = useApp((s) => s.themePref);
  const accent = useApp((s) => s.accent);
  const setThemePref = useApp((s) => s.setThemePref);
  const setAccent = useApp((s) => s.setAccent);
  const docKind = useApp((s) => s.docKind);
  const t = useT();

  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // 点击弹层外部或按 Esc 关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <nav className="rail">
      {docKind === "pdf" &&
        RAIL.map((r) => (
          <button
            key={r.id}
            title={t(r.labelKey)}
            className={leftVisible && leftTab === r.id ? "active" : ""}
            onClick={() => {
              if (leftVisible && leftTab === r.id) toggleLeft();
              else setLeftTab(r.id);
            }}
          >
            {r.icon}
          </button>
        ))}
      <span style={{ flex: 1 }} />
      <div className="appearance-wrap" ref={wrapRef}>
        <button
          title={t("外观")}
          className={open ? "active" : ""}
          onClick={() => setOpen((v) => !v)}
        >
          {isDarkTheme(theme) ? "☀" : "🌙"}
        </button>
        {open && (
          <div className="appearance-pop">
            <div className="appearance-title">{t("外观")}</div>
            <div className="appearance-grid">
              {PREFS.map((p) => (
                <button
                  key={p.id}
                  className={"appearance-item" + (themePref === p.id ? " active" : "")}
                  onClick={() => setThemePref(p.id)}
                >
                  <span className={"appearance-swatch sw-" + p.id} />
                  <span>{t(p.labelKey)}</span>
                </button>
              ))}
            </div>
            <div className="appearance-title">{t("强调色")}</div>
            <div className="appearance-accents">
              {ACCENTS.map((c) => (
                <button
                  key={c}
                  className={"appearance-dot" + (accent === c ? " active" : "")}
                  style={{ background: c }}
                  title={c}
                  onClick={() => setAccent(accent === c ? null : c)}
                />
              ))}
              <input
                type="color"
                className="appearance-picker"
                value={accent ?? "#0067c0"}
                title={t("强调色")}
                onChange={(e) => setAccent(e.target.value)}
              />
            </div>
            <button className="appearance-reset" onClick={() => setAccent(null)}>
              {t("重置")}
            </button>
          </div>
        )}
      </div>
    </nav>
  );
}
