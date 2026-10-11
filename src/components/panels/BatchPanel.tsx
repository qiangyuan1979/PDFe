import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useApp } from "../../state/store";
import { translateError, useT } from "../../i18n";
import { batchProcessFile, isApiError } from "../../lib/ipc";
import type { BatchOp, CompressLevel, EncryptOptions } from "../../lib/ipc";

type OpKind = "compress" | "encrypt" | "decrypt";
type ItemStatus = "pending" | "processing" | "done" | "failed";

interface BatchItem {
  id: number;
  path: string;
  name: string;
  status: ItemStatus;
  /** 处理失败时的错误文案。 */
  message?: string;
  /** 成功后的产物字节数。 */
  outputSize?: number;
}

const OPS: { id: OpKind; labelKey: string }[] = [
  { id: "compress", labelKey: "压缩" },
  { id: "encrypt", labelKey: "加密" },
  { id: "decrypt", labelKey: "导出明文副本" },
];

const LEVELS: { id: CompressLevel; labelKey: string }[] = [
  { id: "light", labelKey: "轻度（仅结构优化）" },
  { id: "standard", labelKey: "标准（推荐）" },
  { id: "strong", labelKey: "强力" },
];

const PERMS: { key: keyof Omit<EncryptOptions, "userPassword" | "ownerPassword">; labelKey: string }[] = [
  { key: "allowPrint", labelKey: "允许打印（含高质量打印）" },
  { key: "allowCopy", labelKey: "允许复制文本与图形" },
  { key: "allowModify", labelKey: "允许修改文档内容" },
  { key: "allowAnnotate", labelKey: "允许添加或修改注释" },
];

/** 各操作的输出文件名后缀。 */
const SUFFIX: Record<OpKind, string> = {
  compress: "_compressed",
  encrypt: "_encrypted",
  decrypt: "_plain",
};

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

function stem(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return `${dir.replace(/[\\/]+$/, "")}${sep}${name}`;
}

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function BatchPanel() {
  const pushToast = useApp((s) => s.pushToast);
  const locale = useApp((s) => s.locale);
  const t = useT();

  const [items, setItems] = useState<BatchItem[]>([]);
  const [opKind, setOpKind] = useState<OpKind>("compress");
  const [level, setLevel] = useState<CompressLevel>("standard");
  const [userPw, setUserPw] = useState("");
  const [ownerPw, setOwnerPw] = useState("");
  const [perms, setPerms] = useState({
    allowPrint: true,
    allowCopy: true,
    allowModify: true,
    allowAnnotate: true,
  });
  const [openPw, setOpenPw] = useState("");
  const [outDir, setOutDir] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const nextIdRef = useRef(1);
  const cancelRef = useRef(false);

  const makeItems = useCallback(
    (paths: string[]): BatchItem[] =>
      paths.map((p) => ({
        id: nextIdRef.current++,
        path: p,
        name: baseName(p),
        status: "pending" as ItemStatus,
      })),
    [],
  );

  const addPaths = useCallback(
    (paths: string[]) => {
      const pdfs = paths.filter((p) => p.toLowerCase().endsWith(".pdf"));
      if (pdfs.length === 0) return;
      setItems((prev) => [...prev, ...makeItems(pdfs)]);
    },
    [makeItems],
  );

  // 系统级文件拖入（Tauri v2 原生接管 OS 拖放，HTML5 drop 收不到文件）
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        if (e.payload.type === "enter" || e.payload.type === "over") {
          setDropActive(true);
        } else if (e.payload.type === "leave") {
          setDropActive(false);
        } else {
          setDropActive(false);
          addPaths(e.payload.paths);
        }
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addPaths]);

  const addFiles = async () => {
    const picked = await open({
      multiple: true,
      filters: [{ name: t("PDF 文档"), extensions: ["pdf"] }],
    });
    if (Array.isArray(picked)) setItems((prev) => [...prev, ...makeItems(picked)]);
  };

  const pickOutput = async () => {
    const p = await open({ title: t("选择输出文件夹"), directory: true, multiple: false });
    if (typeof p === "string") setOutDir(p);
  };

  const remove = (id: number) => setItems((prev) => prev.filter((it) => it.id !== id));
  const clearList = () => setItems([]);

  const buildOp = (): BatchOp | null => {
    if (opKind === "compress") return { kind: "compress", level };
    if (opKind === "decrypt") return { kind: "decrypt" };
    if (!userPw && !ownerPw) {
      pushToast("error", t("请至少填写打开密码或权限密码，否则不会产生任何限制。"));
      return null;
    }
    return { kind: "encrypt", options: { userPassword: userPw, ownerPassword: ownerPw, ...perms } };
  };

  const start = async (ids: number[]) => {
    if (ids.length === 0) return;
    if (!outDir) {
      pushToast("error", t("请先添加文件并选择输出文件夹"));
      return;
    }
    const op = buildOp();
    if (!op) return;

    const targets = items.filter((it) => ids.includes(it.id));
    setRunning(true);
    cancelRef.current = false;
    let ok = 0;
    let fail = 0;

    for (const it of targets) {
      if (cancelRef.current) break;
      setItems((prev) =>
        prev.map((x) => (x.id === it.id ? { ...x, status: "processing", message: undefined } : x)),
      );
      const outputPath = joinPath(outDir, `${stem(it.name)}${SUFFIX[opKind]}.pdf`);
      try {
        const res = await batchProcessFile(it.path, outputPath, op, openPw || null);
        ok += 1;
        setItems((prev) =>
          prev.map((x) => (x.id === it.id ? { ...x, status: "done", outputSize: res.outputSize } : x)),
        );
      } catch (e) {
        fail += 1;
        const message = isApiError(e) ? translateError(locale, e.code, e.args, e.message) : String(e);
        setItems((prev) => prev.map((x) => (x.id === it.id ? { ...x, status: "failed", message } : x)));
      }
    }

    setRunning(false);
    if (cancelRef.current) {
      pushToast("info", t("已取消"));
    } else {
      pushToast(fail === 0 ? "info" : "error", t("批次完成：成功 {ok}，失败 {fail}", { ok, fail }));
    }
  };

  const statusLabel = (s: ItemStatus): string =>
    s === "pending"
      ? t("待处理")
      : s === "processing"
        ? t("进行中…")
        : s === "done"
          ? t("已完成")
          : t("失败");

  const doneCount = items.filter((i) => i.status === "done").length;
  const pendingIds = items.filter((i) => i.status !== "done").map((i) => i.id);
  const failedIds = items.filter((i) => i.status === "failed").map((i) => i.id);
  const canStart = !running && items.length > 0 && outDir !== null;

  return (
    <div className="task-body">
      <button className="btn-primary" onClick={addFiles} disabled={running}>
        {t("➕ 添加文件")}
      </button>

      <div className={`merge-list${dropActive ? " drop-active" : ""}`}>
        {items.length === 0 && (
          <p className="placeholder">{t("点击上方按钮添加 PDF 文件，或把文件拖到这里")}</p>
        )}
        {items.map((it) => (
          <div key={it.id} className="merge-item">
            <div className="merge-row">
              <span className="merge-name" title={it.path}>
                {it.name}
              </span>
              <span className={`batch-status batch-status-${it.status}`}>{statusLabel(it.status)}</span>
              {!running && (
                <div className="merge-actions">
                  <button onClick={() => remove(it.id)} style={{ color: "var(--danger)" }}>
                    ✕
                  </button>
                </div>
              )}
            </div>
            {it.status === "done" && it.outputSize !== undefined && (
              <div className="merge-meta">{fmtSize(it.outputSize)}</div>
            )}
            {it.status === "failed" && it.message && (
              <div className="merge-meta merge-meta-error">{it.message}</div>
            )}
          </div>
        ))}
      </div>

      <div className="field">
        <label>{t("操作类型")}</label>
        <div className="compress-levels">
          {OPS.map((o) => (
            <label key={o.id} className="compress-level">
              <input
                type="radio"
                name="batch-op"
                checked={opKind === o.id}
                onChange={() => setOpKind(o.id)}
                disabled={running}
              />
              <span className="compress-level-label">{t(o.labelKey)}</span>
            </label>
          ))}
        </div>
      </div>

      {opKind === "compress" && (
        <div className="field">
          <label>{t("压缩档位")}</label>
          <div className="compress-levels">
            {LEVELS.map((l) => (
              <label key={l.id} className="compress-level">
                <input
                  type="radio"
                  name="batch-level"
                  checked={level === l.id}
                  onChange={() => setLevel(l.id)}
                  disabled={running}
                />
                <span className="compress-level-label">{t(l.labelKey)}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {opKind === "encrypt" && (
        <>
          <div className="field">
            <label htmlFor="batch-user-pw">{t("打开密码（打开文档时需输入，可留空）")}</label>
            <input
              id="batch-user-pw"
              type="password"
              autoComplete="new-password"
              value={userPw}
              onChange={(e) => setUserPw(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="field">
            <label htmlFor="batch-owner-pw">{t("权限密码（留空则与打开密码相同）")}</label>
            <input
              id="batch-owner-pw"
              type="password"
              autoComplete="new-password"
              value={ownerPw}
              onChange={(e) => setOwnerPw(e.target.value)}
              disabled={running}
            />
          </div>
          {PERMS.map((row) => (
            <label key={row.key} className="perm-check">
              <input
                type="checkbox"
                checked={perms[row.key]}
                onChange={(e) => setPerms((p) => ({ ...p, [row.key]: e.target.checked }))}
                disabled={running}
              />
              <span className="perm-label">{t(row.labelKey)}</span>
            </label>
          ))}
        </>
      )}

      <div className="field">
        <label htmlFor="batch-open-pw">{t("加密文档的打开密码（未加密可留空）")}</label>
        <input
          id="batch-open-pw"
          type="password"
          autoComplete="current-password"
          value={openPw}
          onChange={(e) => setOpenPw(e.target.value)}
          disabled={running}
        />
      </div>

      <div className="merge-output">
        <label>{t("输出文件夹")}</label>
        <span
          className="merge-output-path"
          title={outDir ?? undefined}
          style={outDir ? undefined : { color: "var(--fg-dim)" }}
        >
          {outDir ?? t("未选择")}
        </span>
        <button onClick={pickOutput} disabled={running}>
          {t("选择…")}
        </button>
        {outDir && (
          <button title={t("清除")} onClick={() => setOutDir(null)} disabled={running}>
            ✕
          </button>
        )}
      </div>

      {items.length > 0 && (
        <p className="placeholder">
          {t("已处理 {done}/{total}", { done: doneCount, total: items.length })}
        </p>
      )}

      <div className="task-footer">
        <button className="btn-primary" onClick={() => start(pendingIds)} disabled={!canStart}>
          {running ? t("处理中…") : t("开始处理")}
        </button>
        {running && <button onClick={() => (cancelRef.current = true)}>{t("取消")}</button>}
        {!running && failedIds.length > 0 && (
          <button onClick={() => start(failedIds)} disabled={!outDir}>
            {t("重试失败项")}
          </button>
        )}
        {!running && items.length > 0 && <button onClick={clearList}>{t("清除列表")}</button>}
      </div>
    </div>
  );
}
