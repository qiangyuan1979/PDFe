import { useEffect } from "react";
import { useApp } from "../state/store";

/** 快捷键绑定回调合集（App.tsx 注入，避免 hook 内重复定义） */
export interface ShortcutHandlers {
  onOpenFile: () => void;
  onSave: () => void;
  onUndo: () => void;
  onRedo: () => void;
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
}

/**
 * 全局快捷键（仅当焦点不在 INPUT/TEXTAREA 时生效）。
 *
 * 完整快捷键清单（详见 README）：
 * - Ctrl+O          打开
 * - Ctrl+S          保存
 * - Ctrl+F / F3     搜索
 * - Ctrl+Z          撤销
 * - Ctrl+Y / Ctrl+Shift+Z 重做
 * - Ctrl+0          实际大小
 * - Ctrl+= / Ctrl++ 放大
 * - Ctrl+-          缩小
 * - Ctrl+1/2/3      视图：连续 / 单页 / 双页
 * - Ctrl+G          切换左面板
 * - Ctrl+Shift+L    切换语言（中/英/日）
 * - Ctrl+Shift+T    切换主题（深/浅）
 * - F1 / ?          帮助
 * - Escape          关闭面板
 * - PageUp/PageDown 翻页
 * - Home/End        首末页
 * - Space           向下滚动（与 PageDown 一致）
 * - Delete          删除选中页面（如有）
 */
export function useShortcuts(h: ShortcutHandlers): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      // contenteditable 也跳过
      if ((e.target as HTMLElement)?.isContentEditable) return;

      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const st = useApp.getState();
      // 原生阅读（非 PDF）没有页面/缩放/搜索，除打开文件外的 PDF 专属快捷键全部忽略
      const pdf = st.docKind === "pdf";

      // --- Ctrl 系列 ---
      if (mod && !e.shiftKey && !e.altKey) {
        if (key === "o") {
          e.preventDefault();
          h.onOpenFile();
          return;
        }
        if (!pdf) return;
        if (key === "s") {
          e.preventDefault();
          h.onSave();
          return;
        }
        if (key === "f") {
          e.preventDefault();
          st.setSearchOpen(true);
          return;
        }
        if (key === "z") {
          e.preventDefault();
          h.onUndo();
          return;
        }
        if (key === "y") {
          e.preventDefault();
          h.onRedo();
          return;
        }
        if (key === "0") {
          e.preventDefault();
          h.resetZoom();
          return;
        }
        if (key === "=" || key === "+") {
          e.preventDefault();
          h.zoomBy(1.2);
          return;
        }
        if (key === "-") {
          e.preventDefault();
          h.zoomBy(1 / 1.2);
          return;
        }
        if (key === "1") {
          e.preventDefault();
          st.setViewMode("continuous");
          return;
        }
        if (key === "2") {
          e.preventDefault();
          st.setViewMode("single");
          return;
        }
        if (key === "3") {
          e.preventDefault();
          st.setViewMode("dual");
          return;
        }
        if (key === "g") {
          e.preventDefault();
          st.toggleLeft();
          return;
        }
      }

      // --- Ctrl+Shift 系列 ---
      if (mod && e.shiftKey && !e.altKey) {
        if (key === "z") {
          e.preventDefault();
          h.onRedo();
          return;
        }
        if (key === "l") {
          e.preventDefault();
          const cur = st.locale;
          const next: "zh" | "en" | "ja" = cur === "zh" ? "en" : cur === "en" ? "ja" : "zh";
          st.setLocale(next);
          return;
        }
      }

      // --- 单键 ---
      if (e.key === "PageDown" || e.key === " " || e.key === "Spacebar") {
        if (!pdf) return;
        e.preventDefault();
        st.jumpToPage(st.currentPage + 1);
        return;
      }
      if (e.key === "PageUp") {
        if (!pdf) return;
        e.preventDefault();
        st.jumpToPage(st.currentPage - 1);
        return;
      }
      if (e.key === "Home") {
        if (!pdf) return;
        e.preventDefault();
        st.jumpToPage(0);
        return;
      }
      if (e.key === "End") {
        if (!pdf) return;
        e.preventDefault();
        st.jumpToPage(Math.max(0, st.pageCount - 1));
        return;
      }
      if (e.key === "Escape") {
        st.setSearchOpen(false);
        st.setHelpOpen(false);
        st.closeTask();
        return;
      }
      if (e.key === "F3") {
        if (!pdf) return;
        e.preventDefault();
        st.setSearchOpen(true);
        return;
      }
      if (e.key === "F1" || e.key === "?") {
        e.preventDefault();
        st.setHelpOpen(true);
        return;
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [h]);
}
