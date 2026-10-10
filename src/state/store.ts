import { create } from "zustand";
import type {
  AnnotationInfo,
  DocumentInfo,
  PageInfo,
  BookmarkNode,
  SearchHitRect,
  TextDocPayload,
} from "../lib/ipc";
import { isApiError } from "../lib/ipc";
import { pageCache, thumbCache } from "../lib/bitmapCache";
import { translateError } from "../i18n";

export type ViewMode = "continuous" | "single" | "dual";
export type FitMode = "none" | "width" | "page";
export type LeftTab = "thumbnails" | "bookmarks";
/** 当前打开的文档类型：`pdf` 走 PDFium 画布；`text` 走原生阅读视图（markdown/html/epub/纯文本）。 */
export type DocKind = "pdf" | "text";
export type TaskId =
  | "merge"
  | "split"
  | "watermark"
  | "edit"
  | "security"
  | "export"
  | "diagnose"
  | "ocr"
  | "forms"
  | null;
/** 内容编辑面板的内层页签 */
export type EditTab = "annot" | "deep";
/** 深度编辑当前工具：select 不请求画布选区；rewrite/addtext 请求框选；image/scandetect 为纯参数模式 */
export type DeepEditMode = "select" | "rewrite" | "addtext" | "image" | "scandetect";

export interface SearchHit {
  pageIndex: number;
  /** 命中在页面纯文本中的字符偏移 */
  offset: number;
  snippet: string;
}

/** CSS 像素坐标的矩形（左上原点） */
export interface CssRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 完成的画布选区（带页索引与缩放） */
export interface CompletedSelection {
  pageIndex: number;
  rect: CssRect;
  /** Canvas 渲染时使用的缩放因子（page.width * scale = cssW） */
  scale: number;
  /** 选区来源模式：rewrite / watermarkRemove / addText */
  mode: string;
}

/** PDF 点坐标矩形（左下原点） */
export interface PdfRegion {
  left: number;
  bottom: number;
  right: number;
  top: number;
}

/** 水印去除的「待删区域」预览（误删保护：执行前必须先让用户看到将被删除的内容）。
 * `pageIndex` 为 null 表示叠加到所有页 —— 自动检测命中的是每页同位置重复对象。 */
export interface RemovalPreview {
  regions: PdfRegion[];
  pageIndex: number | null;
}

/** 水印「添加」的实时预览（当前页叠加层）。
 * 由 `WatermarkAddPanel` 在参数变化时重算写入；`regions` 为放置框（九宫格 1 项、平铺多项），
 * 几何规则来自 `src/lib/watermarkLayout.ts`（与后端 `watermark.rs` 一致）。 */
export interface WatermarkPreview {
  /** 只叠加在这一页（0-based） */
  pageIndex: number;
  regions: PdfRegion[];
  kind: "text" | "image";
  /** kind === "text" 时的水印文本 */
  text: string;
  /** kind === "text" 时的字号（pt） */
  fontSize: number;
  /** kind === "text" 时的填充色 "#rrggbb" */
  color: string;
  /** 0–100 */
  opacity: number;
  /** 顺时针角度 */
  rotation: number;
  /** kind === "image" 时的本地图片 URL（asset 协议，由 convertFileSrc 生成） */
  imageSrc: string | null;
  /** 是否平铺；平铺时画布不提供拖放手柄（与后端一致，忽略 custom） */
  tiled: boolean;
}

/** 双击文字命中：区域 + 原文 + 原字体样式（用于重写时预填/沿用）。 */
export interface DblClickText {
  region: PdfRegion;
  pageIndex: number;
  originalText: string;
  /** 原字体名（已去子集前缀）；读取失败为空串。 */
  fontName: string;
  /** 原字号（pt）。 */
  fontSize: number;
  /** 原填充色 "#rrggbb"；读取失败为空串。 */
  color: string;
}

/** 文字编辑态：双击命中的区域，画布上以虚线框 + 光标标记，关闭重写面板时清空。 */
export interface TextEditTarget {
  pageIndex: number;
  region: PdfRegion;
}

export interface Toast {
  id: number;
  kind: "info" | "error";
  message: string;
}

interface AppState {
  // 文档
  docId: number | null;
  /** 文档类型：`pdf` 走 PDFium；`text` 走原生阅读视图（此时 `docId` 为 null）。 */
  docKind: DocKind;
  /** 原生阅读载荷；仅 `docKind === "text"` 时非空。 */
  textDoc: TextDocPayload | null;
  /** markdown 编辑草稿；仅 markdown 文档非空，其余为 null。 */
  mdDraft: string | null;
  /** markdown 是否处于编辑模式（false = 预览）。 */
  mdEditing: boolean;
  fileName: string;
  filePath: string | null;
  /** 磁盘文件字节数；来自后端 DocumentInfo.fileSizeBytes。 */
  fileSizeBytes: number;
  pageCount: number;
  pages: PageInfo[];
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoDepth: number;
  redoDepth: number;
  loading: boolean;
  /** 页面内容版本号（水印/旋转等修改后自增，触发画布重渲） */
  renderRevision: number;

  // 视图
  viewMode: ViewMode;
  fitMode: FitMode;
  scale: number;
  currentPage: number; // 0-based
  scrollTop: number;

  // 面板
  leftTab: LeftTab;
  leftVisible: boolean;
  task: TaskId;
  /** 内容编辑面板的内层页签 */
  editTab: EditTab;
  /** 深度编辑当前工具；画布浮动胶囊与面板单选共用这一状态 */
  editMode: DeepEditMode;
  searchOpen: boolean;
  helpOpen: boolean;
  aboutOpen: boolean;

  // 搜索
  searchQuery: string;
  searchHits: SearchHit[];
  searchActive: number; // 当前 F3 定位的命中索引，-1 表示无
  searching: boolean;
  /** 每页的搜索高亮矩形（PDF 点坐标，从后端拉取）；key 为 pageIndex */
  searchHighlights: Record<number, SearchHitRect[]>;
  /** 当前正在加载高亮的页码集合，避免重复请求 */
  loadingHighlights: Set<number>;

  /** 每页的注释列表（key 为 pageIndex）。打开文档时全量拉取，后续编辑后局部刷新 */
  annotations: Record<number, AnnotationInfo[]>;

  // 主题
  theme: "light" | "dark";

  // 语言
  locale: "zh" | "en" | "ja";

  // 缩略图选择
  selectedPages: Set<number>;
  thumbFocus: number;

  // 书签
  bookmarks: BookmarkNode[];
  bookmarksLoading: boolean;

  // 画布选区（CSS 像素坐标，存储的是 page-holder 内的相对坐标）
  /** 哪个面板请求选区（'rewrite' 等）；null 表示无选区模式 */
  selectingFor: string | null;
  /** 当前正在拖拽的选区（实时）；松开鼠标后清空。同时记录所属 pageIndex，
   * 以便每个 PageView 精细订阅「是否为我」，避免拖拽时全部 PageView 重渲。 */
  liveSelection: (CssRect & { pageIndex: number }) | null;
  /** 已完成的选区（CSS 像素坐标 + 当前页索引 + 缩放比例） */
  completedSelection: CompletedSelection | null;
  /** 双击文字命中：由 Canvas 写入，TaskPanel 监听后打开重写 modal */
  dblClickText: DblClickText | null;
  /** 文字编辑态目标：画布上显示虚线框 + 光标；由重写面板关闭时清空 */
  editTarget: TextEditTarget | null;
  /** 水印去除的待删预览区域（见 RemovalPreview）。非空时叠加显示在画布上，
   * 用于「强制预览确认」：用户必须先看到将被删除的区域才能执行删除。 */
  removalPreview: RemovalPreview | null;
  /** 水印「添加」的实时预览（见 WatermarkPreview）。非空时叠加显示在当前页。 */
  watermarkPreview: WatermarkPreview | null;
  /** 水印添加的画布拖放位置（归一化因子，左下原点）；null 表示用九宫格 position */
  watermarkCustomPos: { x: number; y: number } | null;

  toasts: Toast[];
  jumpTarget: { page: number; nonce: number };
  flashTarget: { page: number; nonce: number };

  // actions
  jumpToPage: (page: number, flash?: boolean) => void;
  updatePages: (info: DocumentInfo) => void;
  setDoc: (info: DocumentInfo, path: string | null) => void;
  /** 打开原生阅读文档（非 PDF）；内部会把 `docId` 置空并清掉 PDF 专属状态。 */
  setTextDoc: (payload: TextDocPayload, path: string | null) => void;
  /** 更新 markdown 草稿（编辑时调用，会置 dirty）。 */
  setMdDraft: (s: string) => void;
  /** 切换 markdown 预览 / 编辑模式。 */
  setMdEditing: (b: boolean) => void;
  clearDoc: () => void;
  setViewMode: (m: ViewMode) => void;
  setScale: (s: number) => void;
  applyFitScale: (s: number) => void;
  setFitMode: (f: FitMode) => void;
  setCurrentPage: (p: number) => void;
  setScrollTop: (t: number) => void;
  setLeftTab: (t: LeftTab) => void;
  toggleLeft: () => void;
  openTask: (t: TaskId) => void;
  closeTask: () => void;
  setEditTab: (t: EditTab) => void;
  /** 切换深度编辑工具；同时同步画布选区模式（唯一的联动入口） */
  setEditMode: (m: DeepEditMode) => void;
  setSearchOpen: (b: boolean) => void;
  setHelpOpen: (b: boolean) => void;
  setAboutOpen: (b: boolean) => void;
  setSelectingFor: (mode: string | null) => void;
  setLiveSelection: (rect: (CssRect & { pageIndex: number }) | null) => void;
  setCompletedSelection: (s: (Omit<CompletedSelection, "mode"> & { mode?: string }) | null) => void;
  setDblClickText: (s: DblClickText | null) => void;
  setEditTarget: (t: TextEditTarget | null) => void;
  /** 设置 / 清空水印去除预览区域（null 表示关闭预览） */
  setRemovalPreview: (preview: RemovalPreview | null) => void;
  /** 设置 / 清空水印添加预览（null 表示关闭预览） */
  setWatermarkPreview: (preview: WatermarkPreview | null) => void;
  /** 设置 / 清空水印拖放位置（null 表示回退九宫格 position） */
  setWatermarkCustomPos: (pos: { x: number; y: number } | null) => void;
  setSearch: (query: string, hits: SearchHit[]) => void;
  setSearchActive: (i: number) => void;
  setSearching: (b: boolean) => void;
  setPageHighlights: (pageIndex: number, rects: SearchHitRect[]) => void;
  addLoadingHighlight: (pageIndex: number) => void;
  removeLoadingHighlight: (pageIndex: number) => void;
  clearSearchHighlights: () => void;
  /** 全量设置某页的注释列表（打开文档 / 删除后刷新时调用） */
  setPageAnnotations: (pageIndex: number, list: AnnotationInfo[]) => void;
  /** 全量替换所有注释（拉取全文档注释时） */
  setAllAnnotations: (map: Record<number, AnnotationInfo[]>) => void;
  /** 清空所有注释（关闭文档时） */
  clearAnnotations: () => void;
  setTheme: (t: "light" | "dark") => void;
  setLocale: (l: "zh" | "en" | "ja") => void;
  toggleSelect: (page: number, ctrl: boolean, shift: boolean) => void;
  clearSelection: () => void;
  markDirty: (b: boolean) => void;
  setCanUndo: (b: boolean) => void;
  setCanRedo: (b: boolean) => void;
  setUndoDepth: (n: number) => void;
  setRedoDepth: (n: number) => void;
  setUndoRedo: (ur: {
    canUndo: boolean;
    canRedo: boolean;
    undoDepth: number;
    redoDepth: number;
  }) => void;
  setLoading: (b: boolean) => void;
  setBookmarks: (b: BookmarkNode[]) => void;
  setBookmarksLoading: (b: boolean) => void;
  pushToast: (kind: Toast["kind"], message: string) => void;
  dismissToast: (id: number) => void;
  errorToast: (e: unknown) => void;
}

/** 阅读位置持久化：按文件名+页数作为指纹 */
const POS_PREFIX = "pdfe:pos:";
export function saveReadingPos(fileName: string, pageCount: number, page: number, scale: number) {
  try {
    localStorage.setItem(POS_PREFIX + `${fileName}:${pageCount}`, JSON.stringify({ page, scale }));
  } catch {
    /* 忽略存储失败 */
  }
}
export function loadReadingPos(
  fileName: string,
  pageCount: number,
): { page: number; scale: number } | null {
  try {
    const raw = localStorage.getItem(POS_PREFIX + `${fileName}:${pageCount}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let toastSeq = 0;

/** 退出内容编辑态：清掉工具选择与画布选区，避免残留在其它面板上。 */
const exitEditState = () => ({
  editMode: "select" as DeepEditMode,
  selectingFor: null,
  liveSelection: null,
  completedSelection: null,
});

export const useApp = create<AppState>((set, get) => ({
  docId: null,
  docKind: "pdf",
  textDoc: null,
  mdDraft: null,
  mdEditing: false,
  fileName: "",
  filePath: null,
  fileSizeBytes: 0,
  pageCount: 0,
  pages: [],
  dirty: false,
  canUndo: false,
  canRedo: false,
  undoDepth: 0,
  redoDepth: 0,
  loading: false,
  renderRevision: 0,

  viewMode: "continuous",
  fitMode: "width",
  scale: 1,
  currentPage: 0,
  scrollTop: 0,

  leftTab: "thumbnails",
  leftVisible: true,
  task: null,
  editTab: "annot",
  editMode: "select",
  selectingFor: null,
  liveSelection: null,
  completedSelection: null,
  dblClickText: null,
  editTarget: null,
  removalPreview: null,
  watermarkPreview: null,
  watermarkCustomPos: null,
  searchOpen: false,
  helpOpen: false,
  aboutOpen: false,

  searchQuery: "",
  searchHits: [],
  searchActive: -1,
  searching: false,
  searchHighlights: {},
  loadingHighlights: new Set(),
  annotations: {},

  theme: window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",

  locale: (localStorage.getItem("pdfe:locale") as "zh" | "en" | "ja") || "zh",

  selectedPages: new Set(),
  thumbFocus: -1,

  bookmarks: [],
  bookmarksLoading: false,

  toasts: [],
  jumpTarget: { page: 0, nonce: 0 },
  flashTarget: { page: -1, nonce: 0 },

  jumpToPage: (page, flash) =>
    set((s) => {
      const p = Math.max(0, Math.min(page, Math.max(0, s.pageCount - 1)));
      const base = { currentPage: p };
      if (flash) {
        return {
          ...base,
          jumpTarget: { page: p, nonce: s.jumpTarget.nonce + 1 },
          flashTarget: { page: p, nonce: s.flashTarget.nonce + 1 },
        };
      }
      return { ...base, jumpTarget: { page: p, nonce: s.jumpTarget.nonce + 1 } };
    }),
  updatePages: (info) => {
    pageCache.clear();
    thumbCache.clear();
    set((s) => ({
      pageCount: info.pageCount,
      pages: info.pages,
      dirty: true,
      renderRevision: s.renderRevision + 1,
    }));
  },

  setDoc: (info, path) => {
    pageCache.clear();
    thumbCache.clear();
    set({
      docId: info.docId,
      docKind: "pdf",
      textDoc: null,
      mdDraft: null,
      mdEditing: false,
      fileName: info.fileName,
      filePath: path,
      fileSizeBytes: info.fileSizeBytes,
      pageCount: info.pageCount,
      pages: info.pages,
      dirty: false,
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      currentPage: 0,
      scrollTop: 0,
      selectedPages: new Set(),
      thumbFocus: -1,
      searchHits: [],
      searchActive: -1,
      searchQuery: "",
      searchHighlights: {},
      loadingHighlights: new Set(),
      removalPreview: null,
      watermarkPreview: null,
      watermarkCustomPos: null,
    });
  },
  setTextDoc: (payload, path) => {
    pageCache.clear();
    thumbCache.clear();
    set({
      docId: null,
      docKind: "text",
      textDoc: payload,
      mdDraft: payload.kind === "markdown" ? (payload.source ?? "") : null,
      mdEditing: false,
      fileName: payload.fileName,
      filePath: path,
      fileSizeBytes: payload.fileSizeBytes,
      pageCount: 0,
      pages: [],
      dirty: false,
      canUndo: false,
      canRedo: false,
      undoDepth: 0,
      redoDepth: 0,
      currentPage: 0,
      scrollTop: 0,
      selectedPages: new Set(),
      thumbFocus: -1,
      searchHits: [],
      searchActive: -1,
      searchQuery: "",
      searchHighlights: {},
      loadingHighlights: new Set(),
      annotations: {},
      bookmarks: [],
      searchOpen: false,
      task: null,
      removalPreview: null,
      watermarkPreview: null,
      watermarkCustomPos: null,
      dblClickText: null,
      editTarget: null,
      ...exitEditState(),
    });
  },
  clearDoc: () =>
    set({
      docId: null,
      docKind: "pdf",
      textDoc: null,
      mdDraft: null,
      mdEditing: false,
      fileName: "",
      filePath: null,
      fileSizeBytes: 0,
      pageCount: 0,
      pages: [],
      dirty: false,
      canUndo: false,
      selectedPages: new Set(),
      dblClickText: null,
      editTarget: null,
      annotations: {},
      removalPreview: null,
      watermarkPreview: null,
      watermarkCustomPos: null,
      ...exitEditState(),
    }),
  setViewMode: (m) => set({ viewMode: m, fitMode: m === "single" ? "page" : "width" }),
  setScale: (s) => set({ scale: Math.min(8, Math.max(0.1, s)), fitMode: "none" }),
  applyFitScale: (s) => set({ scale: Math.min(8, Math.max(0.1, s)) }),
  setFitMode: (f) => set({ fitMode: f }),
  setCurrentPage: (p) => set({ currentPage: p }),
  setScrollTop: (t) => set({ scrollTop: t }),
  setLeftTab: (t) => set({ leftTab: t, leftVisible: true }),
  toggleLeft: () => set((s) => ({ leftVisible: !s.leftVisible })),
  openTask: (t) =>
    set({
      task: t,
      searchOpen: false,
      removalPreview: null,
      watermarkPreview: null,
      watermarkCustomPos: null,
      ...exitEditState(),
    }),
  closeTask: () =>
    set({
      task: null,
      removalPreview: null,
      watermarkPreview: null,
      watermarkCustomPos: null,
      ...exitEditState(),
    }),
  setEditTab: (t) => set({ editTab: t }),
  setEditMode: (m) =>
    set({
      editMode: m,
      selectingFor: m === "rewrite" ? "rewrite" : m === "addtext" ? "addText" : null,
      liveSelection: null,
      completedSelection: null,
    }),
  setSearchOpen: (b) => set({ searchOpen: b }),
  setHelpOpen: (b) => set({ helpOpen: b }),
  setAboutOpen: (b) => set({ aboutOpen: b }),
  setSelectingFor: (mode) =>
    set({
      selectingFor: mode,
      liveSelection: null,
      completedSelection: null,
    }),
  setLiveSelection: (rect) => set({ liveSelection: rect }),
  setCompletedSelection: (s) =>
    set((st) => {
      if (s === null) {
        return { completedSelection: null, liveSelection: null, selectingFor: null };
      }
      return {
        completedSelection: {
          pageIndex: s.pageIndex,
          rect: s.rect,
          scale: s.scale,
          mode: s.mode ?? st.selectingFor ?? "",
        },
        liveSelection: null,
        selectingFor: null,
      };
    }),
  setDblClickText: (s) => set({ dblClickText: s }),
  setEditTarget: (t) => set({ editTarget: t }),
  setRemovalPreview: (preview) => set({ removalPreview: preview }),
  setWatermarkPreview: (preview) => set({ watermarkPreview: preview }),
  setWatermarkCustomPos: (pos) => set({ watermarkCustomPos: pos }),
  setSearch: (query, hits) =>
    set({
      searchQuery: query,
      searchHits: hits,
      searchActive: hits.length ? 0 : -1,
      searchHighlights: {},
      loadingHighlights: new Set(),
    }),
  setSearchActive: (i) => set({ searchActive: i }),
  setSearching: (b) => set({ searching: b }),
  setPageHighlights: (pageIndex, rects) =>
    set((s) => ({
      searchHighlights: { ...s.searchHighlights, [pageIndex]: rects },
    })),
  setPageAnnotations: (pageIndex, list) =>
    set((s) => ({ annotations: { ...s.annotations, [pageIndex]: list } })),
  setAllAnnotations: (map) => set({ annotations: map }),
  clearAnnotations: () => set({ annotations: {} }),
  addLoadingHighlight: (pageIndex) =>
    set((s) => {
      const next = new Set(s.loadingHighlights);
      next.add(pageIndex);
      return { loadingHighlights: next };
    }),
  removeLoadingHighlight: (pageIndex) =>
    set((s) => {
      const next = new Set(s.loadingHighlights);
      next.delete(pageIndex);
      return { loadingHighlights: next };
    }),
  clearSearchHighlights: () => set({ searchHighlights: {}, loadingHighlights: new Set() }),
  setTheme: (t) => set({ theme: t }),
  setLocale: (l) => {
    localStorage.setItem("pdfe:locale", l);
    set({ locale: l });
  },
  toggleSelect: (page, ctrl, shift) => {
    const { selectedPages, thumbFocus } = get();
    const next = new Set(selectedPages);
    if (shift && thumbFocus >= 0) {
      const [a, b] = [Math.min(thumbFocus, page), Math.max(thumbFocus, page)];
      for (let i = a; i <= b; i++) next.add(i);
    } else if (ctrl) {
      if (next.has(page)) next.delete(page);
      else next.add(page);
    } else {
      next.clear();
      next.add(page);
    }
    set({ selectedPages: next, thumbFocus: page });
  },
  clearSelection: () => set({ selectedPages: new Set(), thumbFocus: -1 }),
  markDirty: (b) => set({ dirty: b }),
  setMdDraft: (s) => set({ mdDraft: s, dirty: true }),
  setMdEditing: (b) => set({ mdEditing: b }),
  setCanUndo: (b) => set({ canUndo: b }),
  setCanRedo: (b) => set({ canRedo: b }),
  setUndoDepth: (n) => set({ undoDepth: n }),
  setRedoDepth: (n) => set({ redoDepth: n }),
  setUndoRedo: (ur) => set(ur),
  setLoading: (b) => set({ loading: b }),
  setBookmarks: (b) => set({ bookmarks: b }),
  setBookmarksLoading: (b) => set({ bookmarksLoading: b }),
  pushToast: (kind, message) => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(
      () => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },
      kind === "error" ? 5000 : 2500,
    );
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  errorToast: (e) => {
    const locale = get().locale;
    let msg: string;
    if (isApiError(e)) {
      msg = translateError(locale, e.code, e.args, e.message);
    } else {
      msg = e instanceof Error ? e.message : String(e);
    }
    get().pushToast("error", msg);
  },
}));
