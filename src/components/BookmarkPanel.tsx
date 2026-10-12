import { useEffect, useState } from "react";
import { useApp } from "../state/store";
import { useT } from "../i18n";
import { getBookmarks } from "../lib/ipc";
import type { BookmarkNode } from "../lib/ipc";

/** 用户自定义书签（应用级）：按文档内容指纹持久化，不修改 PDF 大纲。 */
interface UserBookmark {
  id: string;
  /** 0-based 页索引。 */
  page: number;
  title: string;
  /** 0-based 缩进层级，用于表现层级。 */
  level: number;
}

const BM_PREFIX = "pdfe:bookmarks:";
const MAX_LEVEL = 6;

function loadUserBookmarks(fingerprint: string): UserBookmark[] {
  if (!fingerprint) return [];
  try {
    const raw = localStorage.getItem(BM_PREFIX + fingerprint);
    const arr = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(arr)) return [];
    return (arr as UserBookmark[]).filter(
      (b) =>
        b &&
        typeof b.id === "string" &&
        Number.isInteger(b.page) &&
        typeof b.title === "string",
    ).map((b) => ({
      ...b,
      level: Math.max(0, Math.min(MAX_LEVEL, Number(b.level) || 0)),
    }));
  } catch {
    return [];
  }
}

function saveUserBookmarks(fingerprint: string, list: UserBookmark[]) {
  if (!fingerprint) return;
  try {
    localStorage.setItem(BM_PREFIX + fingerprint, JSON.stringify(list));
  } catch {
    /* 忽略存储失败 */
  }
}

/** 只读展示文档自带的大纲书签。 */
function OutlineList({
  nodes,
  onJump,
}: {
  nodes: BookmarkNode[];
  onJump: (page: number) => void;
}) {
  const t = useT();
  return (
    <>
      {nodes.map((node, i) => (
        <div key={i}>
          <div
            className="bookmark-item"
            style={{ paddingLeft: 8 + node.level * 16 }}
            onClick={() => onJump(node.pageIndex)}
          >
            {node.title || t("（无标题）")}
          </div>
          {node.children.length > 0 && <OutlineList nodes={node.children} onJump={onJump} />}
        </div>
      ))}
    </>
  );
}

export default function BookmarkPanel() {
  const docId = useApp((s) => s.docId);
  const fingerprint = useApp((s) => s.fingerprint);
  const currentPage = useApp((s) => s.currentPage);
  const jumpToPage = useApp((s) => s.jumpToPage);
  const bookmarks = useApp((s) => s.bookmarks);
  const bookmarksLoading = useApp((s) => s.bookmarksLoading);
  const setBookmarks = useApp((s) => s.setBookmarks);
  const setBookmarksLoading = useApp((s) => s.setBookmarksLoading);
  const errorToast = useApp((s) => s.errorToast);
  const t = useT();

  const [custom, setCustom] = useState<UserBookmark[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  // 切换文档时载入该文档的自定义书签。
  useEffect(() => {
    setCustom(loadUserBookmarks(fingerprint));
    setEditingId(null);
  }, [fingerprint]);

  // 载入 PDF 自带大纲（只读）。
  useEffect(() => {
    if (docId === null) return;
    let cancelled = false;
    setBookmarksLoading(true);
    getBookmarks(docId)
      .then((b) => {
        if (!cancelled) setBookmarks(b);
      })
      .catch((e) => {
        if (!cancelled) errorToast(e);
      })
      .finally(() => {
        if (!cancelled) setBookmarksLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const commit = (list: UserBookmark[]) => {
    setCustom(list);
    saveUserBookmarks(fingerprint, list);
  };

  const addBookmark = () => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const bm: UserBookmark = {
      id,
      page: currentPage,
      title: t("第 {n} 页", { n: currentPage + 1 }),
      level: 0,
    };
    commit([...custom, bm]);
    setEditingId(id);
    setEditTitle(bm.title);
  };

  const remove = (id: string) => commit(custom.filter((b) => b.id !== id));

  const setLevel = (id: string, level: number) =>
    commit(custom.map((b) => (b.id === id ? { ...b, level } : b)));

  const startRename = (b: UserBookmark) => {
    setEditingId(b.id);
    setEditTitle(b.title);
  };

  const commitRename = (id: string) => {
    const title = editTitle.trim();
    commit(custom.map((b) => (b.id === id ? { ...b, title } : b)));
    setEditingId(null);
  };

  return (
    <div className="bookmark-tree">
      <div className="bm-toolbar">
        <button className="bm-add" onClick={addBookmark}>
          {t("添加书签")}
        </button>
      </div>

      {custom.length === 0 && !bookmarksLoading && bookmarks.length === 0 && (
        <div className="bm-empty">{t("文档没有书签")}</div>
      )}

      {custom.length > 0 && <div className="bm-section">{t("我的书签")}</div>}
      {custom.map((b) =>
        editingId === b.id ? (
          <div className="bm-edit" key={b.id} style={{ paddingLeft: 8 + b.level * 16 }}>
            <input
              autoFocus
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(b.id);
                else if (e.key === "Escape") setEditingId(null);
              }}
            />
            <button onClick={() => commitRename(b.id)}>{t("保存")}</button>
            <button onClick={() => setEditingId(null)}>{t("取消")}</button>
          </div>
        ) : (
          <div className="bm-row" key={b.id} style={{ paddingLeft: 8 + b.level * 16 }}>
            <span className="bm-title" title={b.title} onClick={() => jumpToPage(b.page, true)}>
              {b.title || t("（无标题）")}
              <span className="bm-page">{t("第 {n} 页", { n: b.page + 1 })}</span>
            </span>
            <span className="bm-actions">
              <button title={t("重命名")} onClick={() => startRename(b)}>
                ✏
              </button>
              <button
                title={t("减少缩进")}
                disabled={b.level === 0}
                onClick={() => setLevel(b.id, b.level - 1)}
              >
                ⇤
              </button>
              <button
                title={t("缩进")}
                disabled={b.level >= MAX_LEVEL}
                onClick={() => setLevel(b.id, b.level + 1)}
              >
                ⇥
              </button>
              <button title={t("删除")} onClick={() => remove(b.id)}>
                🗑
              </button>
            </span>
          </div>
        ),
      )}

      {bookmarks.length > 0 && (
        <>
          <div className="bm-section">{t("文档书签")}</div>
          <OutlineList nodes={bookmarks} onJump={(p) => jumpToPage(p, true)} />
        </>
      )}
    </div>
  );
}
