import { useEffect, useState } from "react";
import { useApp } from "../../state/store";
import { useT } from "../../i18n";
import { getSecurityStatus, isApiError, renderPage } from "../../lib/ipc";
import type { SecurityStatus } from "../../lib/ipc";

/** 打印渲染缩放：高质量 ≈144 DPI，低质量 ≈90 DPI（PDF 单位为点，1 点 = 1/72 英寸）。 */
const SCALE_HIGH = 2;
const SCALE_LOW = 1.25;
/** 页面点（1/72 英寸）→ CSS 像素（96 DPI）的换算。 */
const PT_TO_PX = 96 / 72;

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

export default function PrintPanel() {
  const docId = useApp((s) => s.docId);
  const pageCount = useApp((s) => s.pageCount);
  const pages = useApp((s) => s.pages);
  const pushToast = useApp((s) => s.pushToast);
  const errorToast = useApp((s) => s.errorToast);
  const t = useT();

  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  // 加密文档需要的打开密码（读取打印权限时使用）。
  const [openPw, setOpenPw] = useState("");
  const [needPw, setNeedPw] = useState(false);
  const [rangeStr, setRangeStr] = useState("");
  const [quality, setQuality] = useState<"high" | "low">("high");
  const [fit, setFit] = useState(true);

  const load = async (pw: string) => {
    if (docId === null) return;
    setLoading(true);
    try {
      const s = await getSecurityStatus(docId, pw);
      setStatus(s);
      setNeedPw(false);
    } catch (e) {
      // 加密文档缺密码属预期情况：改为提示用户补上打开密码。
      if (isApiError(e) && e.code === "password") {
        setStatus(null);
        setNeedPw(true);
      } else {
        errorToast(e);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setStatus(null);
    setOpenPw("");
    setNeedPw(false);
    setRangeStr("");
    setQuality("high");
    setFit(true);
    setBusy(false);
    load("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const canHigh = status?.canPrintHighQuality ?? true;
  const canLow = status?.canPrintLowQuality ?? true;
  const allowed = canHigh || canLow;
  const lowOnly = !canHigh && canLow;
  const effQuality: "high" | "low" = lowOnly ? "low" : quality;

  // 通过隐藏 iframe 载入页面位图后调起系统打印对话框：
  // 打印机、份数与缩放由系统对话框提供；页码范围与适应页面在本面板控制。
  const onPrint = async () => {
    if (docId === null || !allowed) return;
    const ids = parseRange(rangeStr, pageCount);
    if (ids.length === 0) {
      pushToast("info", t("请指定至少一页"));
      return;
    }
    setBusy(true);
    const scale = effQuality === "high" ? SCALE_HIGH : SCALE_LOW;
    let iframe: HTMLIFrameElement | null = null;
    try {
      iframe = document.createElement("iframe");
      iframe.setAttribute("aria-hidden", "true");
      Object.assign(iframe.style, {
        position: "fixed",
        right: "0",
        bottom: "0",
        width: "0",
        height: "0",
        border: "0",
        visibility: "hidden",
      });
      document.body.appendChild(iframe);
      const cdoc = iframe.contentDocument;
      if (!cdoc) throw new Error("iframe document unavailable");
      cdoc.open();
      cdoc.write(
        '<!doctype html><html><head><meta charset="utf-8"><style>' +
          "@page{margin:10mm}" +
          "html,body{margin:0;padding:0;background:#fff}" +
          ".pg{page-break-after:always;text-align:center}" +
          ".pg:last-child{page-break-after:auto}" +
          "canvas{display:block;margin:0 auto;background:#fff}" +
          "</style></head><body></body></html>",
      );
      cdoc.close();
      const body = cdoc.body;
      for (const p of ids) {
        const bmp = await renderPage(docId, p, scale);
        const cv = cdoc.createElement("canvas");
        cv.width = bmp.width;
        cv.height = bmp.height;
        cv.getContext("2d")?.drawImage(bmp, 0, 0);
        bmp.close();
        const info = pages[p];
        if (fit) {
          cv.style.width = "100%";
          cv.style.height = "auto";
        } else if (info) {
          cv.style.width = `${Math.round(info.width * PT_TO_PX)}px`;
          cv.style.height = "auto";
        }
        const wrap = cdoc.createElement("div");
        wrap.className = "pg";
        wrap.appendChild(cv);
        body.appendChild(wrap);
      }
      const win = iframe.contentWindow;
      win?.focus();
      win?.print();
      pushToast("info", t("已发送到系统打印对话框"));
      const el = iframe;
      const cleanup = () => window.setTimeout(() => el.remove(), 500);
      win?.addEventListener("afterprint", cleanup, { once: true });
      // 兜底：若 afterprint 未触发，3 分钟后清理隐藏 iframe。
      window.setTimeout(cleanup, 180000);
    } catch (e) {
      iframe?.remove();
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-body">
      <p className="placeholder">
        {t("将调起系统打印对话框，打印机、份数与缩放均在其中设置。")}
      </p>

      {loading && <p className="placeholder">{t("加载中…")}</p>}

      {needPw && (
        <>
          <p className="placeholder">{t("该文档已加密，请填写现有打开密码后重试")}</p>
          <div className="field">
            <label htmlFor="print-open-pw">{t("现有打开密码")}</label>
            <input
              id="print-open-pw"
              type="password"
              autoComplete="current-password"
              value={openPw}
              onChange={(e) => setOpenPw(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => load(openPw)} disabled={loading}>
              {t("读取打印权限")}
            </button>
          </div>
        </>
      )}

      {status !== null && !allowed && (
        <p className="placeholder" style={{ color: "var(--danger)" }}>
          {t("该文档的权限设置禁止打印")}
        </p>
      )}
      {lowOnly && (
        <p className="placeholder">{t("文档权限仅允许低质量打印，已自动切换为低质量")}</p>
      )}

      <div className="field">
        <label htmlFor="print-range">{t("页码范围（留空 = 全部，如 1,3,5-7）")}</label>
        <input
          id="print-range"
          type="text"
          value={rangeStr}
          onChange={(e) => setRangeStr(e.target.value)}
          placeholder={t("全部")}
          disabled={!allowed}
        />
      </div>

      <div className="form-row">
        <label>{t("打印质量")}</label>
        <select
          value={effQuality}
          disabled={!allowed || lowOnly}
          onChange={(e) => setQuality(e.target.value as "high" | "low")}
        >
          <option value="high" disabled={!canHigh}>
            {t("高（更清晰）")}
          </option>
          <option value="low">{t("低（省墨）")}</option>
        </select>
      </div>

      <div className="form-row">
        <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={fit}
            disabled={!allowed}
            onChange={(e) => setFit(e.target.checked)}
          />
          {t("适应页面")}
        </label>
      </div>

      <div className="task-footer">
        <button
          className="btn-primary"
          onClick={onPrint}
          disabled={busy || docId === null || !allowed}
        >
          {busy ? t("正在准备打印…") : t("开始打印")}
        </button>
      </div>
    </div>
  );
}
