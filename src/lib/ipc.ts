import { invoke } from "@tauri-apps/api/core";

// ---------- 后端数据结构（与 Rust serde camelCase 对应） ----------

export interface PageInfo {
  index: number;
  width: number; // PDF 点（1/72 英寸）
  height: number;
}

export interface DocumentInfo {
  docId: number;
  fileName: string;
  fileSizeBytes: number;
  pageCount: number;
  pages: PageInfo[];
}

/** 后端 AppError 序列化后的形状 */
export interface ApiError {
  code: string;
  message: string;
  args?: Record<string, string>;
}

export function isApiError(e: unknown): e is ApiError {
  if (typeof e !== "object" || e === null) return false;
  const o = e as Record<string, unknown>;
  return typeof o.code === "string" && typeof o.message === "string";
}

// ---------- 命令封装 ----------

export function openDocument(path: string, password?: string): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("open_document", { path, password: password ?? null });
}

export function closeDocument(docId: number): Promise<void> {
  return invoke("close_document", { docId });
}

export function saveDocument(docId: number, path?: string): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("save_document", { docId, path: path ?? null });
}

export function undoDocument(docId: number): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("undo_document", { docId });
}

export function canUndo(docId: number): Promise<boolean> {
  return invoke<boolean>("can_undo", { docId });
}

export function undoDepth(docId: number): Promise<number> {
  return invoke<number>("undo_depth", { docId });
}

export function redoDocument(docId: number): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("redo_document", { docId });
}

export function canRedo(docId: number): Promise<boolean> {
  return invoke<boolean>("can_redo", { docId });
}

export function redoDepth(docId: number): Promise<number> {
  return invoke<number>("redo_depth", { docId });
}

/** 一次性刷新撤销/重做的所有状态（可用性 + 深度），返回四个值的元组 */
export async function refreshUndoRedo(
  docId: number,
): Promise<{ canUndo: boolean; canRedo: boolean; undoDepth: number; redoDepth: number }> {
  const [cu, cr, ud, rd] = await Promise.all([
    canUndo(docId),
    canRedo(docId),
    undoDepth(docId),
    redoDepth(docId),
  ]);
  return { canUndo: cu, canRedo: cr, undoDepth: ud, redoDepth: rd };
}

export function getPageText(docId: number, pageIndex: number): Promise<string> {
  return invoke<string>("get_page_text", { docId, pageIndex });
}

/** 单页搜索命中矩形（PDF 点，左下原点） */
export interface SearchHitRect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface PageSearchResult {
  pageIndex: number;
  hits: SearchHitRect[];
}

/** 在指定页面内搜索关键词，返回所有命中的矩形坐标（用于画布高亮） */
export function searchPageText(
  docId: number,
  pageIndex: number,
  query: string,
  maxHits?: number,
): Promise<PageSearchResult> {
  return invoke<PageSearchResult>("search_page_text", {
    docId,
    pageIndex,
    query,
    maxHits: maxHits ?? null,
  });
}

/** 双击命中的文字片段：外包围盒（PDF 点，左下原点）+ 原文 */
export interface TextPickResult {
  left: number;
  bottom: number;
  right: number;
  top: number;
  text: string;
  /** 命中字符的字体名（已去子集前缀）；读取失败为空串。 */
  fontName: string;
  /** 命中字符的字号（pt）。 */
  fontSize: number;
  /** 命中字符的填充色 "#rrggbb"；读取失败为空串。 */
  color: string;
  fontBold: boolean;
  fontItalic: boolean;
}

/** 给定 PDF 点 (x, y)，返回该位置的词/词组 bounds + 原文 */
export function pickTextAtPoint(
  docId: number,
  pageIndex: number,
  x: number,
  y: number,
): Promise<TextPickResult | null> {
  return invoke<TextPickResult | null>("pick_text_at_point", {
    docId,
    pageIndex,
    x,
    y,
  });
}

export interface BookmarkNode {
  title: string;
  pageIndex: number;
  level: number;
  children: BookmarkNode[];
}

export interface MergeSource {
  path: string;
  ranges?: string | null;
}

/** 单个合并源的预览信息（inspect_merge_sources 返回） */
export interface MergeSourceInfo {
  totalPages: number;
  selectedPages: number;
  error?: ApiError | null;
}

export type SplitMode =
  | { mode: "every_n"; payload: { n: number } }
  | { mode: "ranges"; payload: { ranges: string } }
  | { mode: "by_bookmark"; payload: { level?: number | null } }
  | { mode: "selected"; payload: { pages: number[] } };

export function rotatePages(
  docId: number,
  pages: number[],
  deltaDeg: number,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("rotate_pages", { docId, pages, deltaDeg });
}

export function deletePages(docId: number, pages: number[]): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("delete_pages", { docId, pages });
}

export function duplicatePages(
  docId: number,
  pages: number[],
  destIndex: number,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("duplicate_pages", { docId, pages, destIndex });
}

export function insertBlankPage(
  docId: number,
  atIndex: number,
  width: number,
  height: number,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("insert_blank_page", { docId, atIndex, width, height });
}

export function reorderPages(
  docId: number,
  fromIndices: number[],
  toIndex: number,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("reorder_pages", { docId, fromIndices, toIndex });
}

export function extractPages(
  docId: number,
  pages: number[],
  outputPath?: string | null,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("extract_pages", {
    docId,
    pages,
    outputPath: outputPath ?? null,
  });
}

export function mergeDocuments(
  sources: MergeSource[],
  outputPath?: string | null,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("merge_documents", {
    sources,
    outputPath: outputPath ?? null,
  });
}

/** 合并向导预览：逐源返回总页数 / 选用页数 / 错误 */
export function inspectMergeSources(sources: MergeSource[]): Promise<MergeSourceInfo[]> {
  return invoke<MergeSourceInfo[]>("inspect_merge_sources", { sources });
}

export function splitDocument(
  docId: number,
  mode: SplitMode,
  outputDir: string,
): Promise<string[]> {
  return invoke<string[]>("split_document", { docId, mode, outputDir });
}

export function getBookmarks(docId: number): Promise<BookmarkNode[]> {
  return invoke<BookmarkNode[]>("get_bookmarks", { docId });
}

// ---------- 水印（M4） ----------

export interface WatermarkStyle {
  /** 0–100 */
  opacity: number;
  /** 顺时针角度 */
  rotation: number;
  /** 九宫格：top-left … center … bottom-right */
  position: string;
  tiled: boolean;
  /** 平铺间距（pt） */
  tileSpacing: number;
  /** 画布拖放定位（归一化因子，左下原点，0–1）；非空且未平铺时优先于 position */
  custom?: { x: number; y: number } | null;
}

export interface TextWatermarkOpts {
  text: string;
  fontSize: number;
  /** "#RRGGBB" */
  color: string;
  style: WatermarkStyle;
}

export interface ImageWatermarkOpts {
  imagePath: string;
  /** 水印宽度占页宽比例 0.05–1 */
  scale: number;
  style: WatermarkStyle;
}

export function addTextWatermark(
  docId: number,
  pages: number[],
  opts: TextWatermarkOpts,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("add_text_watermark", { docId, pages, opts });
}

export function addImageWatermark(
  docId: number,
  pages: number[],
  opts: ImageWatermarkOpts,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("add_image_watermark", { docId, pages, opts });
}

// ---------- 深度编辑（M5） ----------

export interface PtRect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface RewriteTextOpts {
  newText: string;
  fontSize: number;
  color: string;
  /** 原字体名，用于尽量沿用原字体；缺失时后端按通用逻辑选字。 */
  fontName?: string | null;
}

export interface RewriteTextResult {
  info: DocumentInfo;
  /** `true` 表示原字体不可用，已用近似字体替代重绘。 */
  approximated: boolean;
}

export function rewriteText(
  docId: number,
  pageIndex: number,
  region: PtRect,
  opts: RewriteTextOpts,
): Promise<RewriteTextResult> {
  return invoke<RewriteTextResult>("rewrite_text", {
    docId,
    pageIndex,
    region,
    opts,
  });
}

export interface AddTextBoxOpts {
  text: string;
  fontSize: number;
  color: string;
  x: number;
  y: number;
}

export function addTextBox(
  docId: number,
  pageIndex: number,
  opts: AddTextBoxOpts,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("add_text_box", {
    docId,
    pageIndex,
    opts,
  });
}

export function replaceImage(
  docId: number,
  pageIndex: number,
  objectIndex: number,
  newImagePath: string,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("replace_image", {
    docId,
    pageIndex,
    objectIndex,
    newImagePath,
  });
}

export function deleteImageObject(
  docId: number,
  pageIndex: number,
  objectIndex: number,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("delete_image_object", {
    docId,
    pageIndex,
    objectIndex,
  });
}

/** 页面上的图片对象（包围盒为 PDF 点坐标，左下原点）。 */
export interface ImageObjectInfo {
  objectIndex: number;
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export function listImageObjects(docId: number, pageIndex: number): Promise<ImageObjectInfo[]> {
  return invoke<ImageObjectInfo[]>("list_image_objects", { docId, pageIndex });
}

/** 移动/缩放图片对象：把当前包围盒映射到目标矩形。 */
export function setImageBounds(
  docId: number,
  pageIndex: number,
  objectIndex: number,
  target: PtRect,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("set_image_bounds", {
    docId,
    pageIndex,
    objectIndex,
    target,
  });
}

export function isScannedPage(docId: number, pageIndex: number): Promise<boolean> {
  return invoke<boolean>("is_scanned_page", { docId, pageIndex });
}

export function clearPageText(docId: number, pages: number[]): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("clear_page_text", { docId, pages });
}

// ---------- 水印去除（M4 part 2） ----------

export interface Rect {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

export interface ObjectFingerprint {
  objectIndex: number;
  kind: string;
  left: number;
  bottom: number;
  right: number;
  top: number;
  occurrence: number;
  totalSampled: number;
  /** Backend fingerprint key. Use this when calling `applyWatermarkRemoval`. */
  key?: string;
}

export interface DetectResult {
  candidates: ObjectFingerprint[];
  totalPages: number;
  sampledPages: number;
}

export interface RemovedSummary {
  info: DocumentInfo;
  removedCount: number;
}

export function removeObjectsInRect(
  docId: number,
  pages: number[],
  rect: Rect,
): Promise<RemovedSummary> {
  return invoke<RemovedSummary>("remove_objects_in_rect", {
    docId,
    pages,
    rect,
  });
}

export function detectWatermarkCandidates(
  docId: number,
  samplePages?: number,
  threshold?: number,
): Promise<DetectResult> {
  return invoke<DetectResult>("detect_watermark_candidates", {
    docId,
    samplePages: samplePages ?? null,
    threshold: threshold ?? null,
  });
}

export function applyWatermarkRemoval(
  docId: number,
  fingerprintKeys: string[],
): Promise<RemovedSummary> {
  return invoke<RemovedSummary>("apply_watermark_removal", {
    docId,
    fingerprintKeys,
    // legacy field, kept so older callers still work — backend will treat it
    // as positional indices if fingerprintKeys is empty.
    selectedIndices: null,
  });
}

// ---------- 注释（M5） ----------

export type AnnotationKind =
  "highlight" | "underline" | "strikeout" | "stickyNote" | "freeText" | "square";

export interface AnnotationInfo {
  index: number;
  pageIndex: number;
  kind: AnnotationKind;
  left: number;
  bottom: number;
  right: number;
  top: number;
  contents: string;
  color: string;
}

export interface RegionSpec {
  left: number; // 0-1
  top: number; // 0-1
  width: number; // 0-1
  height: number; // 0-1
}

export interface AddAnnotationOpts {
  kind: AnnotationKind;
  region: RegionSpec;
  contents: string;
  color: string;
  opacity: number;
}

export function listAnnotations(
  docId: number,
  pageIndex?: number | null,
): Promise<AnnotationInfo[]> {
  return invoke<AnnotationInfo[]>("list_annotations", { docId, pageIndex: pageIndex ?? null });
}

export function addAnnotation(
  docId: number,
  pageIndex: number,
  opts: AddAnnotationOpts,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("add_annotation", { docId, pageIndex, opts });
}

export function deleteAnnotation(
  docId: number,
  pageIndex: number,
  annotationIndex: number,
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("delete_annotation", { docId, pageIndex, annotationIndex });
}

export function clearAnnotations(docId: number, pages: number[]): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("clear_annotations", { docId, pages });
}

// ---------- 文档安全（M6） ----------

export interface SecurityStatus {
  handlerRevision: "Unprotected" | "Revision2" | "Revision3" | "Revision4" | "Unknown" | string;
  canPrintHighQuality: boolean;
  canPrintLowQuality: boolean;
  canModifyDocument: boolean;
  canExtractTextAndGraphics: boolean;
  canAddAnnotations: boolean;
  canFillFormFields: boolean;
  canAssembleDocument: boolean;
  canCreateNewFormFields: boolean;
}

export function getSecurityStatus(
  docId: number,
  password?: string | null,
): Promise<SecurityStatus> {
  return invoke<SecurityStatus>("get_security_status", { docId, password: password ?? null });
}

export function exportPlainCopy(
  docId: number,
  outputPath: string,
  password?: string | null,
): Promise<string> {
  return invoke<string>("export_plain_copy", { docId, outputPath, password: password ?? null });
}

/** 把当前文档以明文 bytes 重新载入内存（移除加密）。加密文档必须提供原打开密码。 */
export function reloadPlain(docId: number, password?: string | null): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("reload_plain", { docId, password: password ?? null });
}

/** 加密导出参数（P4 / M6）。打开密码与权限密码不能同时为空。 */
export interface EncryptOptions {
  /** 打开密码。为空则无需密码即可打开文档（权限限制仍然生效）。 */
  userPassword: string;
  /** 权限密码。为空时回落到打开密码。 */
  ownerPassword: string;
  allowPrint: boolean;
  allowCopy: boolean;
  allowModify: boolean;
  allowAnnotate: boolean;
}

/** 把当前文档以 AES-128 加密副本形式导出到新路径（不改动内存中的明文文档）。 */
export function exportEncryptedCopy(
  docId: number,
  outputPath: string,
  options: EncryptOptions,
): Promise<string> {
  return invoke<string>("export_encrypted_copy", { docId, outputPath, options });
}

// ========== OCR（可选 feature：cargo build --features ocr） ==========

export interface OcrWord {
  text: string;
  left: number;
  bottom: number;
  right: number;
  top: number;
  confidence: number;
}

export interface OcrPageResult {
  pageIndex: number;
  words: OcrWord[];
}

export function ocrPage(
  docId: number,
  pageIndex: number,
  lang?: string,
  dpi?: number,
): Promise<OcrPageResult> {
  return invoke<OcrPageResult>("ocr_page", { docId, pageIndex, lang, dpi });
}

export function ocrApplyTextOverlay(
  docId: number,
  pageIndex: number,
  words: OcrWord[],
): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("ocr_apply_text_overlay", {
    docId,
    pageIndex,
    words,
  });
}

// ---------- 格式互转（M7） ----------

export interface PageRangeSpec {
  pages: number[];
  dpi: number;
  /** "png" | "jpeg" */
  format: string;
}

export interface ImageToPdfOpts {
  imagePaths: string[];
  /** "fit" | "a4" | "letter" | "auto" */
  pageSize: string;
  /** "fit" | "fill" */
  layout: string;
}

export function exportPagesToImages(
  docId: number,
  spec: PageRangeSpec,
  outputDir: string,
): Promise<string[]> {
  return invoke<string[]>("export_pages_to_images", { docId, spec, outputDir });
}

export function imagesToPdf(opts: ImageToPdfOpts, outputPath: string): Promise<string> {
  return invoke<string>("images_to_pdf", { opts, outputPath });
}

// ---------- Office 互转（M8） ----------

export interface OfficeProbe {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export function detectOffice(): Promise<OfficeProbe> {
  return invoke<OfficeProbe>("detect_office");
}

export function convertOfficeToPdf(
  sofficePath: string,
  source: string,
  outputDir: string,
): Promise<string> {
  return invoke<string>("convert_office_to_pdf", {
    sofficePath,
    source,
    outputDir,
  });
}

// ---------- 电子书互转（M10） ----------

export interface EbookToolProbe {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface ConvertEbookOpts {
  source: string;
  output: string;
  author?: string | null;
  title?: string | null;
}

export function detectEbookTools(): Promise<EbookToolProbe> {
  return invoke<EbookToolProbe>("detect_ebook_tools");
}

export function convertEbookToPdf(toolPath: string, opts: ConvertEbookOpts): Promise<string> {
  return invoke<string>("convert_ebook_to_pdf", { toolPath, opts });
}

// ---------- 原生阅读（v2：非 PDF 文档） ----------

/** 原生阅读文档类别；`text` 为纯文本，`code` 为源码，二者都走纯文本渲染。 */
export type TextDocKind = "markdown" | "html" | "epub" | "text" | "code";

export interface TextDocPayload {
  kind: TextDocKind;
  title: string;
  fileName: string;
  fileSizeBytes: number;
  /** 后端探测到的编码名，如 "utf-8" / "gbk"。 */
  encoding: string;
  /** 仅 code 类文档有值（文件扩展名），用于展示。 */
  language: string | null;
  /** markdown / epub 渲染后的 HTML；纯文本与源码为 null。 */
  html: string | null;
  /** 纯文本与源码的原文；markdown / epub 为 null。 */
  text: string | null;
}

export function readTextDoc(path: string): Promise<TextDocPayload> {
  return invoke<TextDocPayload>("read_text_doc", { path });
}

// ---------- 表单（P5+P6 AcroForm） ----------

export type FormFieldKind =
  | "unknown"
  | "pushButton"
  | "checkbox"
  | "radioButton"
  | "comboBox"
  | "listBox"
  | "text"
  | "signature";

export interface FormFieldInfo {
  name: string;
  value: string;
  kind: FormFieldKind;
}

export interface SetFormFieldOpts {
  name: string;
  value: string;
}

export function listFormFields(docId: number): Promise<FormFieldInfo[]> {
  return invoke<FormFieldInfo[]>("list_form_fields", { docId });
}

export function setFormFieldValue(docId: number, opts: SetFormFieldOpts): Promise<DocumentInfo> {
  return invoke<DocumentInfo>("set_form_field_value", { docId, opts });
}

// ---------- 二进制渲染 ----------

/**
 * render_page / render_thumbnail 返回 ArrayBuffer：
 * [width:u32LE][height:u32LE][RGBA 像素...]
 * 解析为 ImageBitmap 供 Canvas 直接绘制。
 */
async function renderBinary(cmd: string, args: Record<string, unknown>): Promise<ImageBitmap> {
  const buf = await invoke<ArrayBuffer>(cmd, args);
  const view = new DataView(buf);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const pixels = new Uint8ClampedArray(buf, 8, width * height * 4);
  const imageData = new ImageData(pixels, width, height);
  return createImageBitmap(imageData);
}

export function renderPage(docId: number, pageIndex: number, scale: number): Promise<ImageBitmap> {
  return renderBinary("render_page", { docId, pageIndex, scale });
}

export function renderThumbnail(docId: number, pageIndex: number): Promise<ImageBitmap> {
  return renderBinary("render_thumbnail", { docId, pageIndex });
}
