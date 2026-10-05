import { useApp } from "../state/store";
import type { TaskId } from "../state/store";
import { useT } from "../i18n";
import { useAppVersion } from "../hooks/useAppVersion";

const TOOLS: { id: Exclude<TaskId, null>; label: string; icon: string }[] = [
  { id: "merge", label: "合并", icon: "🗂" },
  { id: "split", label: "拆分", icon: "✂" },
  { id: "watermark", label: "水印", icon: "💧" },
  { id: "edit", label: "编辑", icon: "✏" },
  { id: "security", label: "密码", icon: "🔒" },
  { id: "export", label: "导出", icon: "🖼" },
  { id: "diagnose", label: "诊断", icon: "🩺" },
  { id: "ocr", label: "OCR", icon: "🔍" },
  { id: "forms", label: "表单", icon: "📝" },
];

export default function Toolbar({
  onOpenFile,
  onUndo,
  onRedo,
}: {
  onOpenFile: () => void;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const t = useT();
  const task = useApp((s) => s.task);
  const openTask = useApp((s) => s.openTask);
  const hasDoc = useApp((s) => s.docId !== null);
  const canUndo = useApp((s) => s.canUndo);
  const canRedo = useApp((s) => s.canRedo);
  const undoDepth = useApp((s) => s.undoDepth);
  const redoDepth = useApp((s) => s.redoDepth);
  const viewMode = useApp((s) => s.viewMode);
  const setViewMode = useApp((s) => s.setViewMode);
  const setSearchOpen = useApp((s) => s.setSearchOpen);
  const searchOpen = useApp((s) => s.searchOpen);
  const setHelpOpen = useApp((s) => s.setHelpOpen);
  const locale = useApp((s) => s.locale);
  const setLocale = useApp((s) => s.setLocale);
  const version = useAppVersion();

  return (
    <header className="toolbar">
      <span className="logo">PDFe</span>
      <button className="tbtn" onClick={onOpenFile} title={t("打开文件（Ctrl+O）")}>
        📂 {t("打开")}
      </button>
      <button
        className="tbtn"
        disabled={!hasDoc || !canUndo}
        onClick={onUndo}
        title={t("撤销（Ctrl+Z）", { count: undoDepth }) + (undoDepth > 0 ? ` · ${undoDepth}` : "")}
      >
        ↶ {t("撤销")}
      </button>
      <button
        className="tbtn"
        disabled={!hasDoc || !canRedo}
        onClick={onRedo}
        title={t("重做（Ctrl+Y）", { count: redoDepth }) + (redoDepth > 0 ? ` · ${redoDepth}` : "")}
      >
        ↷ {t("重做")}
      </button>
      <span className="sep" />
      {TOOLS.map((item) => (
        <button
          key={item.id}
          className={`tbtn${task === item.id ? " active" : ""}`}
          disabled={!hasDoc}
          onClick={() => openTask(task === item.id ? null : item.id)}
        >
          {item.icon} {t(item.label)}
        </button>
      ))}
      <span className="spacer" />
      <button
        className={`tbtn${viewMode === "continuous" ? " active" : ""}`}
        disabled={!hasDoc}
        onClick={() => setViewMode("continuous")}
        title={t("连续滚动")}
      >
        {t("连续")}
      </button>
      <button
        className={`tbtn${viewMode === "single" ? " active" : ""}`}
        disabled={!hasDoc}
        onClick={() => setViewMode("single")}
        title={t("单页")}
      >
        {t("单页")}
      </button>
      <button
        className={`tbtn${viewMode === "dual" ? " active" : ""}`}
        disabled={!hasDoc}
        onClick={() => setViewMode("dual")}
        title={t("双页对开")}
      >
        {t("双页")}
      </button>
      <span className="sep" />
      <button
        className={`tbtn${searchOpen ? " active" : ""}`}
        disabled={!hasDoc}
        onClick={() => setSearchOpen(!searchOpen)}
        title={t("全文搜索（Ctrl+F）")}
      >
        🔍 {t("搜索")}
      </button>
      <button
        className="tbtn"
        onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
        title={locale === "zh" ? "Switch to English" : "切换到中文"}
      >
        {locale === "zh" ? "中" : "EN"}
      </button>
      <button className="tbtn" onClick={() => setHelpOpen(true)} title={t("帮助（? 或 F1）")}>
        ?
      </button>
      {version && (
        <span className="appver" title={t("应用版本")}>
          v{version}
        </span>
      )}
    </header>
  );
}
