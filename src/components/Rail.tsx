import { useApp } from "../state/store";
import { useT } from "../i18n";

const RAIL: { id: "thumbnails" | "bookmarks"; icon: string; labelKey: string }[] = [
  { id: "thumbnails", icon: "▦", labelKey: "页面缩略图" },
  { id: "bookmarks", icon: "🔖", labelKey: "书签" },
];

export default function Rail() {
  const leftTab = useApp((s) => s.leftTab);
  const leftVisible = useApp((s) => s.leftVisible);
  const setLeftTab = useApp((s) => s.setLeftTab);
  const toggleLeft = useApp((s) => s.toggleLeft);
  const theme = useApp((s) => s.theme);
  const setTheme = useApp((s) => s.setTheme);
  const docKind = useApp((s) => s.docKind);
  const t = useT();

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
      <button
        title={theme === "dark" ? t("切换浅色主题") : t("切换深色主题")}
        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
      >
        {theme === "dark" ? "☀" : "🌙"}
      </button>
    </nav>
  );
}
