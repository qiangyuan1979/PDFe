import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useApp } from "../state/store";
import { renderMarkdown, type TextDocKind } from "../lib/ipc";
import { useT } from "../i18n";

/** 纯文本渲染行数上限：超出后截断，避免超长文本拖垮 DOM（与后端 64MB 上限互补）。 */
const MAX_TEXT_LINES = 20000;

/** markdown 编辑时实时预览的防抖间隔（毫秒）。 */
const PREVIEW_DEBOUNCE_MS = 200;

type MdToolId =
  "bold" | "italic" | "code" | "heading" | "ul" | "ol" | "quote" | "link" | "codeblock";

/** 格式化工具条按钮（label 为按钮文字，title 为本地化提示）。 */
const MD_TOOLS: { id: MdToolId; label: string; title: string }[] = [
  { id: "bold", label: "B", title: "加粗" },
  { id: "italic", label: "I", title: "斜体" },
  { id: "code", label: "‹›", title: "行内代码" },
  { id: "heading", label: "H", title: "标题样式" },
  { id: "ul", label: "•", title: "无序列表" },
  { id: "ol", label: "1.", title: "有序列表" },
  { id: "quote", label: "❝", title: "引用" },
  { id: "link", label: "🔗", title: "链接" },
  { id: "codeblock", label: "{ }", title: "代码块" },
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 收集 text 中 needle 的全部出现位置（按大小写敏感开关）。 */
function findMatches(text: string, needle: string, matchCase: boolean): number[] {
  if (!needle) return [];
  const hay = matchCase ? text : text.toLowerCase();
  const pat = matchCase ? needle : needle.toLowerCase();
  const out: number[] = [];
  let idx = hay.indexOf(pat);
  while (idx !== -1) {
    out.push(idx);
    idx = hay.indexOf(pat, idx + pat.length);
  }
  return out;
}

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

/** markdown 源码编辑面板：格式化工具条 + 行号 + 查找/替换（含局部快捷键）。 */
function MarkdownEditor({
  value,
  onChange,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
}) {
  const t = useT();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const gutterRef = useRef<HTMLPreElement>(null);
  // 受控 textarea 重渲染后需要恢复的选区
  const pendingSel = useRef<[number, number] | null>(null);

  const [findOpen, setFindOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  const [activeMatch, setActiveMatch] = useState(0);

  const lineCount = value.split("\n").length;
  const gutter = useMemo(
    () => Array.from({ length: lineCount }, (_, i) => i + 1).join("\n"),
    [lineCount],
  );

  const matches = useMemo(() => findMatches(value, query, matchCase), [value, query, matchCase]);

  // 恢复光标/选区（在受控值更新提交后执行）
  useEffect(() => {
    const sel = pendingSel.current;
    const ta = taRef.current;
    if (!sel || !ta) return;
    pendingSel.current = null;
    ta.focus();
    ta.setSelectionRange(sel[0], sel[1]);
  }, [value]);

  useEffect(() => {
    setActiveMatch(0);
  }, [query, matchCase]);

  function applyEdit(next: string, sel: [number, number]) {
    pendingSel.current = sel;
    onChange(next);
  }

  /** 用 prefix/suffix 包裹当前选区（无选区时插入一对标记并把光标放中间）。 */
  function surround(prefix: string, suffix = prefix) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = value.slice(start, end);
    const next = value.slice(0, start) + prefix + selected + suffix + value.slice(end);
    applyEdit(next, [start + prefix.length, start + prefix.length + selected.length]);
  }

  /** 给选区覆盖的每一行加行首前缀。 */
  function linePrefix(prefix: string) {
    const ta = taRef.current;
    if (!ta) return;
    const start = value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    const nl = value.indexOf("\n", ta.selectionEnd);
    const end = nl === -1 ? value.length : nl;
    const block = value
      .slice(start, end)
      .split("\n")
      .map((line) => prefix + line)
      .join("\n");
    applyEdit(value.slice(0, start) + block + value.slice(end), [start, start + block.length]);
  }

  /** 标题级别循环：无 → H1 → H2 → H3 → 无。 */
  function cycleHeading() {
    const ta = taRef.current;
    if (!ta) return;
    const start = value.lastIndexOf("\n", ta.selectionStart - 1) + 1;
    const nl = value.indexOf("\n", ta.selectionEnd);
    const end = nl === -1 ? value.length : nl;
    const block = value
      .slice(start, end)
      .split("\n")
      .map((line) => {
        const m = /^(#{1,3})\s+/.exec(line);
        if (!m) return "# " + line;
        const level = m[1].length;
        return level >= 3
          ? line.slice(m[0].length)
          : "#".repeat(level + 1) + " " + line.slice(m[0].length);
      })
      .join("\n");
    applyEdit(value.slice(0, start) + block + value.slice(end), [start, start + block.length]);
  }

  function runTool(id: MdToolId) {
    switch (id) {
      case "bold":
        return surround("**");
      case "italic":
        return surround("*");
      case "code":
        return surround("`");
      case "heading":
        return cycleHeading();
      case "ul":
        return linePrefix("- ");
      case "ol":
        return linePrefix("1. ");
      case "quote":
        return linePrefix("> ");
      case "link":
        return surround("[", "](url)");
      case "codeblock":
        return surround("```\n", "\n```");
    }
  }

  /** 选中并滚动到第 i 个匹配处。 */
  function reveal(i: number) {
    const ta = taRef.current;
    const pos = matches[i];
    if (!ta || pos === undefined) return;
    ta.focus();
    ta.setSelectionRange(pos, pos + query.length);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    const line = value.slice(0, pos).split("\n").length - 1;
    ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
    if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
  }

  function gotoMatch(delta: number) {
    if (!matches.length) return;
    const next = (activeMatch + delta + matches.length) % matches.length;
    setActiveMatch(next);
    reveal(next);
  }

  function replaceCurrent() {
    if (!matches.length) return;
    const idx = Math.min(activeMatch, matches.length - 1);
    const pos = matches[idx];
    const next = value.slice(0, pos) + replacement + value.slice(pos + query.length);
    const caret = pos + replacement.length;
    pendingSel.current = [caret, caret];
    onChange(next);
    // 值更新后回到下一处匹配
    window.setTimeout(() => {
      const ta = taRef.current;
      if (!ta) return;
      const hits = findMatches(ta.value, query, matchCase);
      if (!hits.length) {
        setActiveMatch(0);
        return;
      }
      const nIdx = Math.min(idx, hits.length - 1);
      setActiveMatch(nIdx);
      const p = hits[nIdx];
      ta.focus();
      ta.setSelectionRange(p, p + query.length);
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      const line = ta.value.slice(0, p).split("\n").length - 1;
      ta.scrollTop = Math.max(0, line * lh - ta.clientHeight / 2);
      if (gutterRef.current) gutterRef.current.scrollTop = ta.scrollTop;
    }, 0);
  }

  function replaceAll() {
    if (!matches.length) return;
    const re = new RegExp(escapeRegExp(query), matchCase ? "g" : "gi");
    onChange(value.replace(re, () => replacement));
    setActiveMatch(0);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "f") {
      e.preventDefault();
      setFindOpen(true);
      return;
    }
    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      onSave();
      return;
    }
    if (e.key === "Escape" && findOpen) {
      e.preventDefault();
      setFindOpen(false);
    }
  }

  function onScroll() {
    if (taRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = taRef.current.scrollTop;
    }
  }

  return (
    <div className="reader-md-pane">
      <div className="reader-md-toolbar">
        {MD_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tbtn md-tool"
            title={t(tool.title)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runTool(tool.id)}
          >
            {tool.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="tbtn"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setFindOpen((v) => !v)}
        >
          {t("查找")}
        </button>
      </div>
      {findOpen && (
        <div className="reader-md-find">
          <input
            className="md-find-input"
            value={query}
            placeholder={t("查找")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                gotoMatch(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                setFindOpen(false);
              }
            }}
          />
          <span className="reader-md-count">
            {query ? (matches.length ? `${activeMatch + 1}/${matches.length}` : t("未找到")) : ""}
          </span>
          <button
            type="button"
            className="tbtn"
            title={t("上一个匹配")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => gotoMatch(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="tbtn"
            title={t("下一个匹配")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => gotoMatch(1)}
          >
            ↓
          </button>
          <input
            className="md-find-input"
            value={replacement}
            placeholder={t("替换")}
            onChange={(e) => setReplacement(e.target.value)}
          />
          <button
            type="button"
            className="tbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={replaceCurrent}
          >
            {t("替换")}
          </button>
          <button
            type="button"
            className="tbtn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={replaceAll}
          >
            {t("替换全部")}
          </button>
          <label className="md-find-case">
            <input
              type="checkbox"
              checked={matchCase}
              onChange={(e) => setMatchCase(e.target.checked)}
            />
            {t("区分大小写")}
          </label>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            className="tbtn"
            title={t("关闭")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setFindOpen(false)}
          >
            ✕
          </button>
        </div>
      )}
      <div className="reader-md-code">
        <pre className="reader-md-gutter" ref={gutterRef} aria-hidden="true">
          {gutter}
        </pre>
        <textarea
          ref={taRef}
          className="reader-md-source"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={onScroll}
          spellCheck={false}
          wrap="off"
        />
      </div>
    </div>
  );
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
          <MarkdownEditor value={mdDraft ?? ""} onChange={setMdDraft} onSave={onSave} />
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
