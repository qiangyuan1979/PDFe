import { useState } from "react";
import type { CSSProperties } from "react";
import { useApp } from "../../state/store";
import { useT } from "../../i18n";
import { ocrPage, ocrApplyTextOverlay, refreshUndoRedo, isApiError } from "../../lib/ipc";
import type { OcrWord } from "../../lib/ipc";

/** 引导文案：说明、使用步骤与前置条件共用的段落样式。 */
const hint: CSSProperties = { fontSize: 11, lineHeight: 1.6, margin: "0 0 6px" };

export default function OcrPanel() {
  const docId = useApp((s) => s.docId);
  const currentPage = useApp((s) => s.currentPage);
  const pageCount = useApp((s) => s.pageCount);
  const closeTask = useApp((s) => s.closeTask);
  const pushToast = useApp((s) => s.pushToast);
  const updatePages = useApp((s) => s.updatePages);
  const markDirty = useApp((s) => s.markDirty);
  const errorToast = useApp((s) => s.errorToast);
  const setUndoRedo = useApp((s) => s.setUndoRedo);
  const t = useT();

  const [lang, setLang] = useState("eng");
  const [dpi, setDpi] = useState(300);
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [lastResult, setLastResult] = useState<{
    words: OcrWord[];
    page: number;
  } | null>(null);

  const requireDoc = () => {
    if (docId === null) {
      errorToast(new Error("文档未打开"));
      return null;
    }
    return docId;
  };

  const onRecognize = async () => {
    const id = requireDoc();
    if (!id) return;
    setBusy(true);
    try {
      const result = await ocrPage(id, currentPage, lang, dpi);
      setUnavailable(false);
      setLastResult({ words: result.words, page: currentPage });
      pushToast("info", t("OCR 识别完成，共 {n} 个词", { n: result.words.length }));
    } catch (e) {
      if (isApiError(e) && e.code === "ocr_unavailable") setUnavailable(true);
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const onApply = async () => {
    const id = requireDoc();
    if (!id || !lastResult || lastResult.page !== currentPage) {
      errorToast(new Error("请先运行 OCR 识别"));
      return;
    }
    setBusy(true);
    try {
      const info = await ocrApplyTextOverlay(id, currentPage, lastResult.words);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(id));
      pushToast("info", t("OCR 文本层已应用，请立即保存文档"));
      closeTask();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-body">
      <p className="placeholder" style={hint}>
        {t(
          "把扫描版（纯图片）PDF 识别成可搜索文本：结果作为不可见文本层写回，可复制与检索，但不改变原有版面。",
        )}
      </p>
      <p className="placeholder" style={hint}>
        {t("使用步骤：① 设置语言与 DPI → ② 运行 OCR → ③ 应用为可搜索文本层 → ④ 保存文档。")}
      </p>
      <p className="placeholder" style={hint}>
        {t(
          "需使用启用 ocr feature 的构建（cargo build --features ocr），并已安装 Tesseract 与对应语言包。",
        )}
      </p>

      {unavailable && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            fontSize: 12,
            lineHeight: 1.6,
            background: "var(--bg-panel)",
            border: "1px solid var(--danger)",
            borderRadius: 4,
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--danger)", marginBottom: 4 }}>
            {t("当前构建未启用 OCR")}
          </div>
          <div style={{ color: "var(--fg-dim)" }}>
            {t(
              "请使用 cargo build --features ocr 重新构建，并安装 Tesseract 引擎与语言包（如 eng、chi_sim）后重试。",
            )}
          </div>
        </div>
      )}

      <p className="placeholder">
        {t("第 {n} / {total} 页", {
          n: currentPage + 1,
          total: pageCount || "?",
        })}
      </p>

      <div className="form-row">
        <label>{t("语言代码")}</label>
        <input
          type="text"
          value={lang}
          onChange={(e) => setLang(e.target.value)}
          placeholder="eng / chi_sim / jpn_vert"
        />
      </div>
      <p className="placeholder" style={{ ...hint, marginTop: -4 }}>
        {t("eng 英文，chi_sim 简体中文，jpn 日文；多个语言用 + 组合，如 eng+chi_sim。")}
      </p>

      <div className="form-row">
        <label>{t("DPI")}</label>
        <input
          type="number"
          min={72}
          max={600}
          value={dpi}
          onChange={(e) => setDpi(parseInt(e.target.value) || 300)}
        />
      </div>
      <p className="placeholder" style={{ ...hint, marginTop: -4 }}>
        {t("扫描件推荐 300；过低可能漏字，过高会明显变慢。")}
      </p>

      <div className="task-footer" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="btn-primary" onClick={onRecognize} disabled={busy || docId === null}>
          {busy ? t("识别中…") : t("运行 OCR")}
        </button>
        <button
          onClick={onApply}
          disabled={busy || docId === null || !lastResult || lastResult.page !== currentPage}
        >
          {t("应用为可搜索文本层")}
        </button>
      </div>

      {lastResult && (
        <div
          style={{
            marginTop: 12,
            padding: 8,
            fontSize: 12,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}
        >
          <div>
            {t("已识别 {n} 个词（页 {p}）", {
              n: lastResult.words.length,
              p: lastResult.page + 1,
            })}
          </div>
          {lastResult.words.length > 0 ? (
            <div
              style={{
                marginTop: 4,
                color: "var(--fg-dim)",
                fontSize: 11,
              }}
            >
              {lastResult.words
                .slice(0, 8)
                .map((w) => w.text)
                .join(" · ")}
              {lastResult.words.length > 8 ? " …" : ""}
            </div>
          ) : (
            <div style={{ marginTop: 4, color: "var(--danger)", fontSize: 11, lineHeight: 1.6 }}>
              {t("未识别到文字：可尝试提高 DPI，或更换/追加语言代码后重试。")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
