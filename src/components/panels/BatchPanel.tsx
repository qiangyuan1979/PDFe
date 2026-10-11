import { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useApp } from "../../state/store";
import { translateError, useT } from "../../i18n";
import { batchProcessFile, isApiError } from "../../lib/ipc";
import type { BatchOp, CompressLevel, EncryptOptions } from "../../lib/ipc";

type StepKind = "watermark" | "pageNumbers" | "compress" | "encrypt";
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

const STEPS: { id: StepKind; labelKey: string }[] = [
  { id: "watermark", labelKey: "文字水印" },
  { id: "pageNumbers", labelKey: "添加页码" },
  { id: "compress", labelKey: "压缩" },
  { id: "encrypt", labelKey: "加密" },
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

const POSITIONS: { k: string; label: string }[] = [
  { k: "top-left", label: "◤" },
  { k: "top-center", label: "▲" },
  { k: "top-right", label: "◥" },
  { k: "middle-left", label: "◀" },
  { k: "center", label: "◉" },
  { k: "middle-right", label: "▶" },
  { k: "bottom-left", label: "◣" },
  { k: "bottom-center", label: "▼" },
  { k: "bottom-right", label: "◢" },
];

/** 单步操作对应的输出文件名后缀。 */
const STEP_SUFFIX: Record<StepKind, string> = {
  watermark: "_watermarked",
  pageNumbers: "_numbered",
  compress: "_compressed",
  encrypt: "_encrypted",
};

/** 依「水印 → 页码 → 压缩 → 加密」的规范顺序构造操作链。 */
function buildOps(
  steps: Record<StepKind, boolean>,
  wm: { text: string; fontSize: number; color: string; opacity: number; rotation: number; position: string; tiled: boolean; tileSpacing: number },
  pn: { format: string; start: number; fontSize: number; color: string; opacity: number; position: string },
  level: CompressLevel,
  enc: { userPassword: string; ownerPassword: string; allowPrint: boolean; allowCopy: boolean; allowModify: boolean; allowAnnotate: boolean },
): BatchOp[] {
  const ops: BatchOp[] = [];
  if (steps.watermark) {
    ops.push({
      kind: "watermark",
      options: {
        text: wm.text,
        fontSize: wm.fontSize,
        color: wm.color,
        style: {
          opacity: wm.opacity,
          rotation: wm.rotation,
          position: wm.position,
          tiled: wm.tiled,
          tileSpacing: wm.tileSpacing,
          custom: null,
        },
      },
    });
  }
  if (steps.pageNumbers) {
    ops.push({ kind: "pageNumbers", options: { ...pn } });
  }
  if (steps.compress) ops.push({ kind: "compress", level });
  if (steps.encrypt) ops.push({ kind: "encrypt", options: { ...enc } });
  return ops;
}

/** 依操作链推导输出后缀：单步专有后缀 / 多步 `_batch` / 无步骤 `_plain`（导出明文副本）。 */
function suffixFor(ops: BatchOp[]): string {
  if (ops.length === 0) return "_plain";
  if (ops.length === 1) return STEP_SUFFIX[ops[0].kind as StepKind];
  return "_batch";
}

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
  const [steps, setSteps] = useState<Record<StepKind, boolean>>({
    watermark: false,
    pageNumbers: false,
    compress: true,
    encrypt: false,
  });
  const [level, setLevel] = useState<CompressLevel>("standard");
  const [userPw, setUserPw] = useState("");
  const [ownerPw, setOwnerPw] = useState("");
  const [perms, setPerms] = useState({
    allowPrint: true,
    allowCopy: true,
    allowModify: true,
    allowAnnotate: true,
  });
  const [wmText, setWmText] = useState("仅供内部使用");
  const [wmFontSize, setWmFontSize] = useState(36);
  const [wmColor, setWmColor] = useState("#c81e1e");
  const [wmOpacity, setWmOpacity] = useState(30);
  const [wmRotation, setWmRotation] = useState(45);
  const [wmPosition, setWmPosition] = useState("center");
  const [wmTiled, setWmTiled] = useState(false);
  const [pnFormat, setPnFormat] = useState("第 {n} 页 / 共 {total} 页");
  const [pnStart, setPnStart] = useState(1);
  const [pnFontSize, setPnFontSize] = useState(12);
  const [pnColor, setPnColor] = useState("#000000");
  const [pnOpacity, setPnOpacity] = useState(100);
  const [pnPosition, setPnPosition] = useState("bottom-center");
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

  /** 校验并构造操作链；校验失败时提示并返回 null。 */
  const makeOpList = (): BatchOp[] | null => {
    if (steps.watermark && !wmText.trim()) {
      pushToast("error", t("水印文字不能为空"));
      return null;
    }
    if (steps.encrypt && !userPw && !ownerPw) {
      pushToast("error", t("请至少填写打开密码或权限密码，否则不会产生任何限制。"));
      return null;
    }
    return buildOps(
      steps,
      {
        text: wmText,
        fontSize: wmFontSize,
        color: wmColor,
        opacity: wmOpacity,
        rotation: wmRotation,
        position: wmPosition,
        tiled: wmTiled,
        tileSpacing: 120,
      },
      {
        format: pnFormat,
        start: pnStart,
        fontSize: pnFontSize,
        color: pnColor,
        opacity: pnOpacity,
        position: pnPosition,
      },
      level,
      { userPassword: userPw, ownerPassword: ownerPw, ...perms },
    );
  };

  const start = async (ids: number[]) => {
    if (ids.length === 0) return;
    if (!outDir) {
      pushToast("error", t("请先添加文件并选择输出文件夹"));
      return;
    }
    const ops = makeOpList();
    if (!ops) return;

    const suffix = suffixFor(ops);
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
      const outputPath = joinPath(outDir, `${stem(it.name)}${suffix}.pdf`);
      try {
        const res = await batchProcessFile(it.path, outputPath, ops, openPw || null);
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
  const noStep = !steps.watermark && !steps.pageNumbers && !steps.compress && !steps.encrypt;

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
        <label>{t("处理步骤")}</label>
        <div className="compress-levels">
          {STEPS.map((s) => (
            <label key={s.id} className="compress-level">
              <input
                type="checkbox"
                checked={steps[s.id]}
                onChange={() => setSteps((prev) => ({ ...prev, [s.id]: !prev[s.id] }))}
                disabled={running}
              />
              <span className="compress-level-label">{t(s.labelKey)}</span>
            </label>
          ))}
        </div>
      </div>

      {steps.watermark && (
        <>
          <div className="field">
            <label htmlFor="batch-wm-text">{t("水印文字")}</label>
            <input
              id="batch-wm-text"
              value={wmText}
              onChange={(e) => setWmText(e.target.value)}
              placeholder={t("支持中文")}
              disabled={running}
            />
          </div>
          <div className="form-row">
            <label>{t("字号")}</label>
            <input
              type="number"
              min={8}
              max={200}
              value={wmFontSize}
              onChange={(e) => setWmFontSize(Math.max(8, parseInt(e.target.value) || 36))}
              style={{ width: 64 }}
              disabled={running}
            />
            <label>{t("颜色")}</label>
            <input
              type="color"
              value={wmColor}
              onChange={(e) => setWmColor(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="form-row">
            <label>{t("透明度")}</label>
            <input
              type="range"
              min={5}
              max={100}
              value={wmOpacity}
              onChange={(e) => setWmOpacity(parseInt(e.target.value))}
              style={{ flex: 1 }}
              disabled={running}
            />
            <span style={{ width: 34, textAlign: "right", color: "var(--fg-dim)" }}>{wmOpacity}%</span>
          </div>
          <div className="form-row">
            <label>{t("旋转角度")}</label>
            <input
              type="number"
              min={-180}
              max={180}
              value={wmRotation}
              onChange={(e) => setWmRotation(parseInt(e.target.value) || 0)}
              style={{ width: 64 }}
              disabled={running}
            />
            <label className="chk">
              <input
                type="checkbox"
                checked={wmTiled}
                onChange={(e) => setWmTiled(e.target.checked)}
                disabled={running}
              />
              {t("平铺整页")}
            </label>
          </div>
          <div className="field">
            <label>{t("位置")}</label>
            <div className="pos-grid">
              {POSITIONS.map((p) => (
                <button
                  key={p.k}
                  className={wmPosition === p.k ? "active" : ""}
                  onClick={() => setWmPosition(p.k)}
                  disabled={running}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {steps.pageNumbers && (
        <>
          <div className="field">
            <label htmlFor="batch-pn-format">{t("页码格式")}</label>
            <input
              id="batch-pn-format"
              value={pnFormat}
              onChange={(e) => setPnFormat(e.target.value)}
              disabled={running}
            />
            <p className="placeholder" style={{ marginTop: 6, fontSize: 11 }}>
              {t("支持 {n}（当前页）与 {total}（总页数）")}
            </p>
          </div>
          <div className="form-row">
            <label>{t("起始页码")}</label>
            <input
              type="number"
              min={1}
              value={pnStart}
              onChange={(e) => setPnStart(Math.max(1, parseInt(e.target.value) || 1))}
              style={{ width: 64 }}
              disabled={running}
            />
            <label>{t("字号")}</label>
            <input
              type="number"
              min={6}
              max={72}
              value={pnFontSize}
              onChange={(e) => setPnFontSize(Math.max(6, parseInt(e.target.value) || 12))}
              style={{ width: 64 }}
              disabled={running}
            />
            <label>{t("颜色")}</label>
            <input
              type="color"
              value={pnColor}
              onChange={(e) => setPnColor(e.target.value)}
              disabled={running}
            />
          </div>
          <div className="form-row">
            <label>{t("透明度")}</label>
            <input
              type="range"
              min={5}
              max={100}
              value={pnOpacity}
              onChange={(e) => setPnOpacity(parseInt(e.target.value))}
              style={{ flex: 1 }}
              disabled={running}
            />
            <span style={{ width: 34, textAlign: "right", color: "var(--fg-dim)" }}>{pnOpacity}%</span>
          </div>
          <div className="field">
            <label>{t("位置")}</label>
            <div className="pos-grid">
              {POSITIONS.map((p) => (
                <button
                  key={p.k}
                  className={pnPosition === p.k ? "active" : ""}
                  onClick={() => setPnPosition(p.k)}
                  disabled={running}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {steps.compress && (
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

      {steps.encrypt && (
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

      {noStep && (
        <p className="placeholder">
          {t("未选择任何步骤时，将导出明文副本（移除密码与权限）。")}
        </p>
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
