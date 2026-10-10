import { useEffect, useMemo, useState } from "react";
import { useApp } from "../state/store";
import { renderMarkdown, type TextDocKind } from "../lib/ipc";
import { useT } from "../i18n";

/** 纯文本渲染行数上限：超出后截断，避免超长文本拖垮 DOM（与后端 64MB 上限互补）。 */
const MAX_TEXT_LINES = 20000;

/** markdown 编辑时实时预览的防抖间隔（毫秒）。 */
const PREVIEW_DEBOUNCE_MS = 200;

const KIND_LABEL: Record<TextDocKind, string> = {
  markdown: "Markdown 文档",
  html: "HTML 文档",
  epub: "EPUB 电子书",
  text: "纯文本",
  code: "源代码",
};

/** 把 markdown / epub 生成的内联 HTML 包进带主题样式的 iframe 文档（iframe 本身禁脚本）。 */
function wrapHtml(body: string, dark: boolean): string {
  const bg = dark ? "#1e1e1e" : "#ffffff";
  const fg = dark ? "#e0e0e0" : "#1f1f1f";
  const muted = dark ? "#9a9a9a" : "#6b6b6b";
  const border = dark ? "#3a3a3a" : "#d9d9d9";
  const codeBg = dark ? "#2a2a2a" : "#f2f2f2";
  const link = dark ? "#4cc2ff" : "#0067c0";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:${dark ? "dark" : "light"}}
body{margin:0;padding:32px 40px;background:${bg};color:${fg};
  font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif;font-size:16px;line-height:1.7;
  word-wrap:break-word}
h1,h2,h3,h4{line-height:1.3;margin:1.4em 0 .6em}
h1{font-size:1.9em;border-bottom:1px solid ${border};padding-bottom:.3em}
h2{font-size:1.5em;border-bottom:1px solid ${border};padding-bottom:.25em}
p{margin:.8em 0}
a{color:${link}}
table{border-collapse:collapse;margin:1em 0;display:block;overflow-x:auto}
th,td{border:1px solid ${border};padding:6px 12px}
th{background:${codeBg}}
code{background:${codeBg};padding:.15em .35em;border-radius:4px;font-family:Consolas,monospace;font-size:.9em}
pre{background:${codeBg};padding:12px 14px;border-radius:6px;overflow-x:auto}
pre code{background:none;padding:0}
blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid ${border};color:${muted}}
img{max-width:100%;height:auto}
hr{border:0;border-top:1px solid ${border}}
.epub-section+.epub-section{margin-top:2em;padding-top:1em;border-top:1px dashed ${border}}
</style></head><body>${body}</body></html>`;
}

export default function Reader({ onSave }: { onSave: () => void }) {
  const textDoc = useApp((s) => s.textDoc);
  const theme = useApp((s) => s.theme);
  const dirty = useApp((s) => s.dirty);
  const mdDraft = useApp((s) => s.mdDraft);
  const setMdDraft = useApp((s) => s.setMdDraft);
  const mdEditing = useApp((s) => s.mdEditing);
  const setMdEditing = useApp((s) => s.setMdEditing);
  const t = useT();

  const isMarkdown = textDoc?.kind === "markdown";
  const canEditMd = isMarkdown && mdDraft !== null;

  // 编辑态的实时预览：源码变化后防抖调用后端渲染（与打开时同一套 pulldown-cmark 规则）
  const [previewHtml, setPreviewHtml] = useState("");
  useEffect(() => {
    if (!canEditMd || !mdEditing || mdDraft === null) return;
    let cancelled = false;
    const id = window.setTimeout(() => {
      renderMarkdown(mdDraft)
        .then((html) => {
          if (!cancelled) setPreviewHtml(html);
        })
        .catch(() => {});
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [canEditMd, mdEditing, mdDraft]);

  const textLines = useMemo(() => {
    if (!textDoc || (textDoc.kind !== "text" && textDoc.kind !== "code")) return null;
    const lines = (textDoc.text ?? "").split("\n");
    const truncated = lines.length > MAX_TEXT_LINES;
    const shown = truncated ? lines.slice(0, MAX_TEXT_LINES) : lines;
    return {
      body: shown.join("\n"),
      gutter: shown.map((_, i) => i + 1).join("\n"),
      truncated,
      total: lines.length,
    };
  }, [textDoc]);

  if (!textDoc) return null;

  const isText = textDoc.kind === "text" || textDoc.kind === "code";

  return (
    <div className="reader-wrap">
      <div className="reader-bar">
        <span className="reader-kind">{t(KIND_LABEL[textDoc.kind])}</span>
        {canEditMd && (
          <>
            <button className="tbtn" onClick={() => setMdEditing(!mdEditing)}>
              {mdEditing ? t("预览") : t("编辑")}
            </button>
            <button className="tbtn" onClick={onSave} disabled={!dirty}>
              {t("保存")}
            </button>
            {dirty && <span className="reader-dirty">{t("未保存")}</span>}
          </>
        )}
        <span style={{ flex: 1 }} />
        <span>{t("编码：{enc}", { enc: textDoc.encoding })}</span>
        {textDoc.language && <span>{t("语言：{lang}", { lang: textDoc.language })}</span>}
        {textLines && <span>{t("行数：{n}", { n: textLines.total })}</span>}
      </div>
      {isText ? (
        <div className="reader-text-view">
          <div className="reader-text-inner">
            <pre className="reader-gutter" aria-hidden="true">
              {textLines?.gutter}
            </pre>
            <pre className="reader-text">{textLines?.body}</pre>
          </div>
        </div>
      ) : canEditMd && mdEditing ? (
        <div className="reader-md-edit">
          <textarea
            className="reader-md-source"
            value={mdDraft ?? ""}
            onChange={(e) => setMdDraft(e.target.value)}
            spellCheck={false}
          />
          <iframe
            className="reader-frame"
            title={textDoc.fileName}
            sandbox=""
            srcDoc={wrapHtml(previewHtml || textDoc.html || "", theme === "dark")}
          />
        </div>
      ) : (
        <iframe
          className="reader-frame"
          title={textDoc.fileName}
          sandbox=""
          srcDoc={
            textDoc.kind === "html"
              ? (textDoc.html ?? "")
              : wrapHtml(textDoc.html ?? "", theme === "dark")
          }
        />
      )}
      {textLines?.truncated && (
        <div className="reader-note">{t("文件过大，仅显示前 {n} 行", { n: MAX_TEXT_LINES })}</div>
      )}
    </div>
  );
}
