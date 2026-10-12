import { useEffect, useState } from "react";
import { useApp } from "../../state/store";
import { useT } from "../../i18n";
import { cropPages, refreshUndoRedo } from "../../lib/ipc";
import type { CropSpec, RegionSpec } from "../../lib/ipc";

/** 解析页码表达式（1-based）；留空表示全部页面。返回 0-based 页索引，升序去重。 */
function parseRange(text: string, pageCount: number): number[] {
  const txt = text.trim();
  if (!txt) return Array.from({ length: pageCount }, (_, i) => i);
  const out = new Set<number>();
  for (const part of txt.split(",")) {
    const p = part.trim();
    if (!p) continue;
    if (p.includes("-")) {
      const [a, b] = p.split("-").map((x) => parseInt(x.trim(), 10));
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
          if (i >= 1 && i <= pageCount) out.add(i - 1);
        }
      }
    } else {
      const v = parseInt(p, 10);
      if (!isNaN(v) && v >= 1 && v <= pageCount) out.add(v - 1);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const round4 = (v: number) => Math.round(v * 10000) / 10000;

export default function CropPanel() {
  const docId = useApp((s) => s.docId);
  const pageCount = useApp((s) => s.pageCount);
  const pages = useApp((s) => s.pages);
  const currentPage = useApp((s) => s.currentPage);
  const pushToast = useApp((s) => s.pushToast);
  const errorToast = useApp((s) => s.errorToast);
  const updatePages = useApp((s) => s.updatePages);
  const markDirty = useApp((s) => s.markDirty);
  const setUndoRedo = useApp((s) => s.setUndoRedo);
  const closeTask = useApp((s) => s.closeTask);
  const selectingFor = useApp((s) => s.selectingFor);
  const setSelectingFor = useApp((s) => s.setSelectingFor);
  const completedSelection = useApp((s) => s.completedSelection);
  const setCompletedSelection = useApp((s) => s.setCompletedSelection);
  const t = useT();

  const [scope, setScope] = useState<"all" | "current" | "custom">("all");
  const [rangeStr, setRangeStr] = useState("");
  const [region, setRegion] = useState<RegionSpec | null>(null);
  const [margin, setMargin] = useState(20);
  const [busy, setBusy] = useState(false);

  // 消费画布框选结果（CSS px ÷ scale = PDF 点，再按页宽高归一化为 0-1）
  useEffect(() => {
    if (!completedSelection || completedSelection.mode !== "crop") return;
    const sel = completedSelection;
    const pageInfo = pages[sel.pageIndex];
    if (!pageInfo || pageInfo.width <= 0 || pageInfo.height <= 0) return;
    const s = sel.scale;
    if (s <= 0) return;
    const { rect: r } = sel;
    const width = (r.right - r.left) / s / pageInfo.width;
    const height = (r.bottom - r.top) / s / pageInfo.height;
    if (width <= 0 || height <= 0) {
      setCompletedSelection(null);
      return;
    }
    setRegion({
      left: round4(clamp01(r.left / s / pageInfo.width)),
      top: round4(clamp01(r.top / s / pageInfo.height)),
      width: round4(clamp01(width)),
      height: round4(clamp01(height)),
    });
    setCompletedSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSelection]);

  const resolvePages = (): number[] | null => {
    if (scope === "all") return [];
    if (scope === "current") return [currentPage];
    const ps = parseRange(rangeStr, pageCount);
    if (!ps.length) {
      pushToast("info", t("请输入页码范围"));
      return null;
    }
    return ps;
  };

  const run = async (spec: CropSpec, okMsg: string) => {
    if (docId === null) return;
    const pageList = resolvePages();
    if (pageList === null) return;
    setBusy(true);
    try {
      const info = await cropPages(docId, pageList, spec);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", okMsg);
      closeTask();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const applyRegion = () => {
    if (!region || region.width <= 0 || region.height <= 0) {
      pushToast("info", t("请先在画布上框选裁切区域"));
      return;
    }
    void run({ mode: "region", region }, t("已应用裁切"));
  };

  const applyMargin = () => {
    if (!(margin > 0)) {
      pushToast("info", t("请输入大于 0 的页边距"));
      return;
    }
    void run({ mode: "margin", margin }, t("已应用裁切"));
  };

  const scopes = [
    { k: "all", label: t("全部页") },
    { k: "current", label: t("当前页") },
    { k: "custom", label: t("自选") },
  ];

  const selecting = selectingFor === "crop";

  return (
    <div className="task-body">
      <label>{t("作用范围")}</label>
      <div className="split-modes">
        {scopes.map((m) => (
          <label key={m.k} className={`split-mode${scope === m.k ? " active" : ""}`}>
            <input
              type="radio"
              checked={scope === m.k}
              onChange={() => setScope(m.k as typeof scope)}
              style={{ display: "none" }}
            />
            {m.label}
          </label>
        ))}
      </div>
      {scope === "custom" && (
        <div className="form-row">
          <input
            type="text"
            placeholder={t("如 1-3,5,7-9")}
            value={rangeStr}
            onChange={(e) => setRangeStr(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      )}

      <div className="form-row">
        <button
          onClick={() => setSelectingFor(selecting ? null : "crop")}
          disabled={busy || docId === null}
        >
          {selecting ? t("取消框选") : t("🎯 在画布上框选裁切区域")}
        </button>
      </div>
      {selecting && <p className="placeholder">{t("在画布上拖拽框选要保留的区域，松开鼠标完成。")}</p>}

      <div className="form-row">
        <label>{t("裁切框")}</label>
        {region ? (
          <span className="placeholder">
            {t("左 {l}%，上 {tp}%，宽 {w}%，高 {h}%", {
              l: (region.left * 100).toFixed(1),
              tp: (region.top * 100).toFixed(1),
              w: (region.width * 100).toFixed(1),
              h: (region.height * 100).toFixed(1),
            })}
          </span>
        ) : (
          <span className="placeholder">{t("尚未框选裁切区域")}</span>
        )}
      </div>
      <div className="form-row">
        <button className="btn-primary" onClick={applyRegion} disabled={busy || docId === null || !region}>
          {busy ? t("处理中…") : t("应用裁切")}
        </button>
        <button onClick={() => setRegion(null)} disabled={busy || !region}>
          {t("清除")}
        </button>
      </div>

      <hr />

      <div className="form-row">
        <label>{t("统一页边距（PDF 点）")}</label>
        <input
          type="number"
          min={0}
          value={margin}
          onChange={(e) => setMargin(Math.max(0, parseFloat(e.target.value) || 0))}
          style={{ width: 80 }}
        />
      </div>
      <div className="task-footer">
        <button onClick={applyMargin} disabled={busy || docId === null}>
          {t("按页边距裁切")}
        </button>
        <button onClick={() => void run({ mode: "reset" }, t("已重置整页"))} disabled={busy || docId === null}>
          {t("重置整页")}
        </button>
      </div>
    </div>
  );
}
