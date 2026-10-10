import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../state/store";
import { thumbCache, thumbKey } from "../lib/bitmapCache";
import {
  renderThumbnail,
  refreshUndoRedo,
  rotatePages,
  deletePages,
  duplicatePages,
  insertBlankPage,
  insertTemplatePage,
  type PageTemplate,
  reorderPages,
  extractPages,
  closeDocument,
} from "../lib/ipc";
import { save } from "@tauri-apps/plugin-dialog";
import { useT } from "../i18n";

const THUMB_W = 150;
const ITEM_PAD = 12;

interface ContextMenuState {
  x: number;
  y: number;
  pageIndex: number;
}

// 模板页选项；label 为中文原文（i18n 以此为 key）。
const TEMPLATE_OPTIONS: { id: PageTemplate; label: string }[] = [
  { id: "blank", label: "空白" },
  { id: "lined", label: "横线" },
  { id: "grid", label: "网格" },
  { id: "dotted", label: "点阵" },
];

function PageTemplateDialog({
  onPick,
  onClose,
}: {
  onPick: (template: PageTemplate) => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="tpl-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-dialog-head">
          <h3>{t("插入模板页")}</h3>
          <button className="tpl-close" onClick={onClose} title={t("关闭")}>
            ✕
          </button>
        </div>
        <div className="tpl-options">
          {TEMPLATE_OPTIONS.map((opt) => (
            <button key={opt.id} className="tpl-opt" onClick={() => onPick(opt.id)}>
              <span className={`tpl-prev tpl-prev-${opt.id}`} aria-hidden />
              <span className="tpl-opt-label">{t(opt.label)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// 缩略图 in-flight 去重：同一 key 同时只发一次请求
const thumbInflight = new Map<string, Promise<ImageBitmap>>();

const ThumbItem = React.memo(function ThumbItem({
  docId,
  item,
  cssH,
  selected,
  current,
  isDropTarget,
  dropPosition,
  onClick,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  docId: number;
  item: { index: number };
  cssH: number;
  selected: boolean;
  current: boolean;
  isDropTarget: boolean;
  dropPosition: "before" | "after" | null;
  onClick: (it: { index: number }, e: React.MouseEvent) => void;
  onContextMenu: (it: { index: number }, e: React.MouseEvent) => void;
  onDragStart: (it: { index: number }, e: React.DragEvent) => void;
  onDragOver: (it: { index: number }, e: React.DragEvent) => void;
  onDrop: (it: { index: number }, e: React.DragEvent) => void;
  onDragEnd: () => void;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const renderRevision = useApp((s) => s.renderRevision);
  const pageIndex = item.index;

  useEffect(() => {
    let cancelled = false;
    const key = thumbKey(docId, pageIndex);
    const paint = (bmp: ImageBitmap) => {
      const canvas = ref.current;
      if (!canvas || cancelled) return;
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d")?.drawImage(bmp, 0, 0);
    };
    const cached = thumbCache.get(key);
    if (cached) {
      paint(cached);
      return;
    }
    // in-flight 去重
    let p = thumbInflight.get(key);
    if (!p) {
      p = renderThumbnail(docId, pageIndex)
        .then((bmp) => {
          thumbCache.set(key, bmp);
          return bmp;
        })
        .finally(() => thumbInflight.delete(key));
      thumbInflight.set(key, p);
    }
    p.then((bmp) => {
      if (cancelled) return;
      paint(bmp);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [docId, pageIndex, renderRevision]);

  return (
    <div
      className={`thumb-item${selected ? " selected" : ""}${current ? " current" : ""}${
        isDropTarget && dropPosition === "before" ? " drop-before" : ""
      }${isDropTarget && dropPosition === "after" ? " drop-after" : ""}`}
      style={{ width: THUMB_W + 20, height: cssH + ITEM_PAD + 22 }}
      onClick={(e) => onClick(item, e)}
      onContextMenu={(e) => onContextMenu(item, e)}
      draggable
      onDragStart={(e) => onDragStart(item, e)}
      onDragOver={(e) => onDragOver(item, e)}
      onDrop={(e) => onDrop(item, e)}
      onDragEnd={onDragEnd}
    >
      <canvas ref={ref} style={{ width: THUMB_W, height: cssH }} />
      <span className="cap">{pageIndex + 1}</span>
    </div>
  );
});

export default function ThumbnailPanel() {
  const docId = useApp((s) => s.docId);
  const pages = useApp((s) => s.pages);
  const fileName = useApp((s) => s.fileName);
  const selectedPages = useApp((s) => s.selectedPages);
  const currentPage = useApp((s) => s.currentPage);
  const toggleSelect = useApp((s) => s.toggleSelect);
  const jumpToPage = useApp((s) => s.jumpToPage);
  const updatePages = useApp((s) => s.updatePages);
  const setUndoRedo = useApp((s) => s.setUndoRedo);
  const markDirty = useApp((s) => s.markDirty);
  const errorToast = useApp((s) => s.errorToast);
  const pushToast = useApp((s) => s.pushToast);
  const clearSelection = useApp((s) => s.clearSelection);
  const t = useT();

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [templateDialog, setTemplateDialog] = useState<{ pageIndex: number } | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [dropPosition, setDropPosition] = useState<"before" | "after" | null>(null);
  const [dragging, setDragging] = useState(false);
  // rAF 节流滚动
  const thumbScrollRaf = useRef<number | null>(null);
  const pendingThumbScroll = useRef<number>(0);

  const items = useMemo(() => {
    let top = 0;
    return pages.map((p) => {
      const cssH = (p.height / p.width) * THUMB_W;
      const h = cssH + ITEM_PAD + 22;
      const item = { index: p.index, top, cssH, h };
      top += h;
      return item;
    });
  }, [pages]);
  const totalH = items.length ? items[items.length - 1].top + items[items.length - 1].h : 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setViewH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [docId]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !items[currentPage]) return;
    const it = items[currentPage];
    if (it.top < el.scrollTop || it.top + it.h > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, it.top - 40);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage]);

  useEffect(() => {
    const onDocClick = () => setContextMenu(null);
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const handleRotate = async (delta: number) => {
    if (docId === null || !contextMenu) return;
    const pages = selectedPages.size > 0 ? Array.from(selectedPages) : [contextMenu.pageIndex];
    setContextMenu(null);
    try {
      const info = await rotatePages(docId, pages, delta);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已旋转 {n} 页", { n: pages.length }));
    } catch (e) {
      errorToast(e);
    }
  };

  const handleDelete = async () => {
    if (docId === null || !contextMenu) return;
    const pages = selectedPages.size > 0 ? Array.from(selectedPages) : [contextMenu.pageIndex];
    setContextMenu(null);
    if (!confirm(t("确定删除 {n} 页？此操作可撤销。", { n: pages.length }))) return;
    try {
      const info = await deletePages(docId, pages);
      updatePages(info);
      markDirty(true);
      clearSelection();
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已删除 {n} 页", { n: pages.length }));
    } catch (e) {
      errorToast(e);
    }
  };

  const handleDuplicate = async () => {
    if (docId === null || !contextMenu) return;
    const pages = selectedPages.size > 0 ? Array.from(selectedPages) : [contextMenu.pageIndex];
    const dest = contextMenu.pageIndex + 1;
    setContextMenu(null);
    try {
      const info = await duplicatePages(docId, pages, dest);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已复制 {n} 页", { n: pages.length }));
    } catch (e) {
      errorToast(e);
    }
  };

  const handleInsertBlank = async () => {
    if (docId === null || !contextMenu) return;
    const atIndex = contextMenu.pageIndex;
    const refPage = pages[contextMenu.pageIndex] || pages[0];
    const width = refPage?.width || 595;
    const height = refPage?.height || 842;
    setContextMenu(null);
    try {
      const info = await insertBlankPage(docId, atIndex, width, height);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已插入空白页"));
    } catch (e) {
      errorToast(e);
    }
  };

  const openTemplateDialog = () => {
    if (!contextMenu) return;
    setTemplateDialog({ pageIndex: contextMenu.pageIndex });
    setContextMenu(null);
  };

  const handleInsertTemplate = async (template: PageTemplate) => {
    if (docId === null || !templateDialog) return;
    const atIndex = templateDialog.pageIndex;
    const refPage = pages[atIndex] || pages[0];
    const width = refPage?.width || 595;
    const height = refPage?.height || 842;
    setTemplateDialog(null);
    try {
      const info = await insertTemplatePage(docId, atIndex, width, height, template);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已插入模板页"));
    } catch (e) {
      errorToast(e);
    }
  };

  const handleExtract = async () => {
    if (docId === null || !contextMenu) return;
    const pages = selectedPages.size > 0 ? Array.from(selectedPages) : [contextMenu.pageIndex];
    setContextMenu(null);
    const base = (fileName || "document").replace(/\.pdf$/i, "");
    const outPath = await save({
      title: t("选择提取结果保存位置"),
      defaultPath: `${base}-extract.pdf`,
      filters: [{ name: t("PDF 文档"), extensions: ["pdf"] }],
    });
    if (typeof outPath !== "string") return;
    try {
      const info = await extractPages(docId, pages, outPath);
      // 后端提取时会在内存中登记一份临时文档；此处只导出文件，随即释放它。
      await closeDocument(info.docId).catch(() => {});
      pushToast(
        "info",
        t("已提取 {n} 页到 {name}", {
          n: pages.length,
          name: outPath.split(/[\\/]/).pop() || outPath,
        }),
      );
    } catch (e) {
      errorToast(e);
    }
  };

  const handleDragStart = (e: React.DragEvent, pageIndex: number) => {
    if (docId === null) return;
    setDragging(true);
    const indices =
      selectedPages.size > 0 && selectedPages.has(pageIndex)
        ? Array.from(selectedPages)
        : [pageIndex];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(indices));
  };

  const handleDragOver = (e: React.DragEvent, pageIndex: number) => {
    if (!dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const pos = e.clientY < midY ? "before" : "after";
    setDragOverIndex(pageIndex);
    setDropPosition(pos);
  };

  const handleDrop = async (e: React.DragEvent, targetIndex: number) => {
    if (docId === null || !dragging) return;
    e.preventDefault();
    const data = e.dataTransfer.getData("text/plain");
    let indices: number[];
    try {
      indices = JSON.parse(data);
    } catch {
      return;
    }
    const pos = dropPosition || "after";
    const toIndex = pos === "before" ? targetIndex : targetIndex + 1;
    setDragOverIndex(null);
    setDropPosition(null);
    setDragging(false);
    if (indices.length === 0) return;
    const sorted = [...indices].sort((a, b) => a - b);
    const allInRange = sorted.every((i) => i >= 0 && i < pages.length);
    if (!allInRange) return;
    const isTrivial = sorted.length === 1 && sorted[0] === toIndex;
    if (isTrivial) return;
    try {
      const info = await reorderPages(docId, indices, toIndex);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已移动 {n} 页", { n: indices.length }));
    } catch (err) {
      errorToast(err);
    }
  };

  const handleDragEnd = () => {
    setDragging(false);
    setDragOverIndex(null);
    setDropPosition(null);
  };

  // 用 useCallback 稳定化回调引用，让 React.memo(ThumbItem) 能正确跳过未变化的 item。
  // 注意：selectedPages / currentPage / dragOverIndex 等是 props 维度必需的依赖。
  const handleItemClick = useCallback(
    (it: { index: number }, e: React.MouseEvent) => {
      toggleSelect(it.index, e.ctrlKey || e.metaKey, e.shiftKey);
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) jumpToPage(it.index);
    },
    [toggleSelect, jumpToPage],
  );
  const handleItemContextMenu = useCallback((it: { index: number }, e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, pageIndex: it.index });
  }, []);
  const handleItemDragStart = useCallback(
    (it: { index: number }, e: React.DragEvent) => handleDragStart(e, it.index),
    // handleDragStart 依赖 docId / dragging / selectedPages 已用 ref/params 处理
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [docId, selectedPages],
  );
  const handleItemDragOver = useCallback(
    (it: { index: number }, e: React.DragEvent) => handleDragOver(e, it.index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragging],
  );
  const handleItemDrop = useCallback(
    (it: { index: number }, e: React.DragEvent) => handleDrop(e, it.index),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dragging, dropPosition, pages.length],
  );

  if (docId === null) return null;

  const overscan = 400;
  const first = Math.max(
    0,
    items.findIndex((i) => i.top + i.h >= scrollTop - overscan),
  );
  let last = first;
  while (last < items.length && items[last].top <= scrollTop + viewH + overscan) last++;

  return (
    <div
      className="thumb-list"
      ref={scrollRef}
      onScroll={(e) => {
        const t = (e.target as HTMLDivElement).scrollTop;
        pendingThumbScroll.current = t;
        if (thumbScrollRaf.current !== null) return;
        thumbScrollRaf.current = requestAnimationFrame(() => {
          thumbScrollRaf.current = null;
          setScrollTop(pendingThumbScroll.current);
        });
      }}
    >
      <div style={{ height: totalH, position: "relative" }}>
        {items.slice(first, last + 1).map((it) => (
          <div
            key={it.index}
            style={{
              position: "absolute",
              top: it.top,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <ThumbItem
              docId={docId}
              item={it}
              cssH={it.cssH}
              selected={selectedPages.has(it.index)}
              current={it.index === currentPage}
              isDropTarget={dragOverIndex === it.index}
              dropPosition={dragOverIndex === it.index ? dropPosition : null}
              onClick={handleItemClick}
              onContextMenu={handleItemContextMenu}
              onDragStart={handleItemDragStart}
              onDragOver={handleItemDragOver}
              onDrop={handleItemDrop}
              onDragEnd={handleDragEnd}
            />
          </div>
        ))}
      </div>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => handleRotate(-90)}>{t("↺ 逆时针旋转 90°")}</button>
          <button onClick={() => handleRotate(90)}>{t("↻ 顺时针旋转 90°")}</button>
          <button onClick={() => handleRotate(180)}>{t("⟲ 旋转 180°")}</button>
          <div className="ctx-sep" />
          <button onClick={handleDuplicate}>{t("📋 复制页面")}</button>
          <button onClick={handleInsertBlank}>{t("➕ 插入空白页")}</button>
          <button onClick={openTemplateDialog}>{t("📄 插入模板页…")}</button>
          <button onClick={handleDelete} style={{ color: "var(--danger)" }}>
            {t("🗑 删除页面")}
          </button>
          <div className="ctx-sep" />
          <button onClick={handleExtract}>{t("📤 提取为新文档")}</button>
        </div>
      )}
      {templateDialog && (
        <PageTemplateDialog onPick={handleInsertTemplate} onClose={() => setTemplateDialog(null)} />
      )}
    </div>
  );
}
