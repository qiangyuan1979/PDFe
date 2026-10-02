import { useState } from "react";
import { useApp } from "../state/store";
import { useT } from "../i18n";

export default function StatusBar() {
  const fileName = useApp((s) => s.fileName);
  const pageCount = useApp((s) => s.pageCount);
  const dirty = useApp((s) => s.dirty);
  const docId = useApp((s) => s.docId);
  const docKind = useApp((s) => s.docKind);
  const scale = useApp((s) => s.scale);
  const setScale = useApp((s) => s.setScale);
  const setFitMode = useApp((s) => s.setFitMode);
  const currentPage = useApp((s) => s.currentPage);
  const jumpToPage = useApp((s) => s.jumpToPage);
  const [pageText, setPageText] = useState("");
  const t = useT();

  // 原生阅读：没有页码与缩放，只提示文件与只读状态
  if (docKind === "text") {
    return (
      <footer className="statusbar">
        <span title={fileName}>
          {fileName} · {t("只读")}
        </span>
        <span className="grow" />
      </footer>
    );
  }

  if (docId === null) {
    return (
      <footer className="statusbar">
        <span>{t("未打开文档")}</span>
        <span className="grow" />
      </footer>
    );
  }

  const commitPage = () => {
    const n = parseInt(pageText, 10);
    if (!Number.isNaN(n)) jumpToPage(n - 1);
    setPageText("");
  };

  return (
    <footer className="statusbar">
      <span title={fileName}>
        {fileName} · {t("共")} {pageCount} {t("页")}
        {dirty ? ` · ${t("未保存")}` : ""}
      </span>
      <span className="grow" />
      <span>
        {t("第 ")}
        <input
          className="pageinput"
          value={pageText || String(currentPage + 1)}
          onChange={(e) => setPageText(e.target.value)}
          onFocus={() => setPageText(String(currentPage + 1))}
          onBlur={commitPage}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {t(" / ")} {pageCount}
      </span>
      <span className="zoomctl">
        <button onClick={() => setScale(scale / 1.2)} title={t("缩小")}>
          −
        </button>
        <button style={{ width: 52 }} onClick={() => setFitMode("width")} title={t("适应宽度")}>
          {Math.round(scale * 100)}%
        </button>
        <button onClick={() => setScale(scale * 1.2)} title={t("放大")}>
          ＋
        </button>
        <button onClick={() => setFitMode("page")} title={t("适应页面")}>
          ⤢
        </button>
      </span>
    </footer>
  );
}
