/**
 * 文档路径分类（前端）。
 *
 * 只负责「把路径路由到哪条渲染链路」与打开对话框的过滤器；真正的解析与
 * 格式校验在 src-tauri/src/reader.rs。两侧的扩展名表必须保持一致，
 * 改动其中一侧时请同步另一侧（docPath.test.ts 覆盖本模块行为）。
 */

/** 原生阅读支持的文档类型，与后端 TextDocPayload.kind 对应。 */
export type NativeDocKind = "markdown" | "html" | "epub" | "text" | "code";

export const PDF_EXTS: string[] = ["pdf"];
export const MARKDOWN_EXTS: string[] = ["md", "markdown", "mdown", "mkd"];
export const HTML_EXTS: string[] = ["html", "htm", "xhtml"];
export const EPUB_EXTS: string[] = ["epub"];
/** 纯文本与配置文件 */
export const TEXT_EXTS: string[] = [
  "txt",
  "log",
  "ini",
  "cfg",
  "csv",
  "tsv",
  "json",
  "xml",
  "yaml",
  "yml",
  "toml",
  "properties",
];
/** 源码 */
export const CODE_EXTS: string[] = [
  "c",
  "h",
  "hpp",
  "cpp",
  "cc",
  "cxx",
  "cs",
  "java",
  "kt",
  "kts",
  "py",
  "rb",
  "go",
  "rs",
  "php",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "sql",
  "sh",
  "bash",
  "zsh",
  "bat",
  "cmd",
  "ps1",
  "css",
  "scss",
  "less",
  "vue",
  "svelte",
  "swift",
  "lua",
  "pl",
  "dart",
  "gradle",
];

/** 「文本与源码」分组的扩展名（打开对话框用）。 */
export const TEXT_AND_CODE_EXTS: string[] = [...TEXT_EXTS, ...CODE_EXTS];

/**
 * 取小写扩展名（不含点）。路径分隔符 `\` 与 `/` 都支持。
 * 无扩展名与点开头的隐藏文件（如 `.gitignore`）都返回 `""`。
 */
export function fileExt(path: string): string {
  const base = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** 是否交给 PDFium 打开。 */
export function isPdfPath(path: string): boolean {
  return fileExt(path) === "pdf";
}

/** 判定路径属于哪种原生文档；不属于任何一类（含 PDF、mobi/azw3 等）时返回 null。 */
export function nativeDocKind(path: string): NativeDocKind | null {
  const ext = fileExt(path);
  if (MARKDOWN_EXTS.includes(ext)) return "markdown";
  if (HTML_EXTS.includes(ext)) return "html";
  if (EPUB_EXTS.includes(ext)) return "epub";
  if (CODE_EXTS.includes(ext)) return "code";
  if (TEXT_EXTS.includes(ext)) return "text";
  return null;
}
