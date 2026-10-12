import { useEffect, useMemo, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../../state/store";
import { useT } from "../../i18n";
import {
  refreshUndoRedo,
  rewriteText,
  addTextBox,
  replaceImage,
  deleteImageObject,
  listImageObjects,
  setImageBounds,
  isScannedPage,
  clearPageText,
  addAnnotation,
  listAnnotations,
  deleteAnnotation,
  clearAnnotations,
  flattenAnnotations,
  exportTextFile,
} from "../../lib/ipc";
import type { AnnotationInfo, AnnotationKind, ImageObjectInfo } from "../../lib/ipc";

const ANNOT_KINDS: { k: AnnotationKind; labelKey: string; icon: string }[] = [
  { k: "highlight", labelKey: "高亮", icon: "🖍" },
  { k: "underline", labelKey: "下划线", icon: "U̲" },
  { k: "strikeout", labelKey: "删除线", icon: "S̶" },
  { k: "stickyNote", labelKey: "便签", icon: "📝" },
  { k: "freeText", labelKey: "文字框", icon: "T" },
  { k: "square", labelKey: "矩形", icon: "▭" },
];

/**
 * 空注释列表的共享常量。
 * 选择器若写成 `s.annotations[i] ?? []`，每次调用都会产生新数组引用，
 * 会破坏 useSyncExternalStore 的快照一致性校验（开发模式下报
 * "Maximum update depth exceeded"）。必须复用同一个引用。
 */
const NO_ANNOTATIONS: AnnotationInfo[] = [];

export default function EditPanel() {
  // 内层页签放在 store：画布浮动胶囊点工具时可直接切到「深度编辑」。
  const tab = useApp((s) => s.editTab);
  const setTab = useApp((s) => s.setEditTab);
  return (
    <>
      <div className="split-modes" style={{ marginBottom: 12 }}>
        <label className={`split-mode${tab === "annot" ? " active" : ""}`}>
          <input
            type="radio"
            checked={tab === "annot"}
            onChange={() => setTab("annot")}
            style={{ display: "none" }}
          />
          <EditAnnotLabel />
        </label>
        <label className={`split-mode${tab === "deep" ? " active" : ""}`}>
          <input
            type="radio"
            checked={tab === "deep"}
            onChange={() => setTab("deep")}
            style={{ display: "none" }}
          />
          <EditDeepLabel />
        </label>
      </div>
      {tab === "annot" ? <AnnotationEditor /> : <DeepEditor />}
    </>
  );
}

function EditAnnotLabel() {
  const t = useT();
  return <>{t("注释")}</>;
}

function EditDeepLabel() {
  const t = useT();
  return <>{t("深度编辑")}</>;
}

function AnnotationEditor() {
  const docId = useApp((s) => s.docId);
  const fileName = useApp((s) => s.fileName);
  const currentPage = useApp((s) => s.currentPage);
  const pageCount = useApp((s) => s.pageCount);
  const updatePages = useApp((s) => s.updatePages);
  const markDirty = useApp((s) => s.markDirty);
  const setUndoRedo = useApp((s) => s.setUndoRedo);
  const setAllAnnotations = useApp((s) => s.setAllAnnotations);
  const jumpToPage = useApp((s) => s.jumpToPage);
  const pushToast = useApp((s) => s.pushToast);
  const errorToast = useApp((s) => s.errorToast);
  const t = useT();

  const annotationsMap = useApp((s) => s.annotations);
  const list: AnnotationInfo[] = annotationsMap[currentPage] ?? NO_ANNOTATIONS;

  // 文档级注释列表：按页码、索引排序。
  const allAnnots = useMemo(() => {
    const arr: AnnotationInfo[] = [];
    for (const key of Object.keys(annotationsMap)) {
      for (const a of annotationsMap[Number(key)]) arr.push(a);
    }
    arr.sort((x, y) => x.pageIndex - y.pageIndex || x.index - y.index);
    return arr;
  }, [annotationsMap]);

  const [kind, setKind] = useState<AnnotationKind>("highlight");
  const [color, setColor] = useState("#ffeb3b");
  const [contents, setContents] = useState("");
  const [busy, setBusy] = useState(false);

  const kindLabel = (k: AnnotationKind) => {
    const found = ANNOT_KINDS.find((x) => x.k === k);
    return found ? t(found.labelKey) : k;
  };

  // 全量刷新：一次 IPC 同时更新本页与文档级列表。
  const reloadAllAnnotations = async () => {
    if (docId === null) return;
    try {
      const data = await listAnnotations(docId, null);
      const map: Record<number, AnnotationInfo[]> = {};
      for (const a of data) {
        (map[a.pageIndex] ??= []).push(a);
      }
      setAllAnnotations(map);
    } catch (e) {
      errorToast(e);
    }
  };

  const add = async () => {
    if (docId === null) return;
    setBusy(true);
    try {
      const region = {
        left: 0.15,
        top: 0.2,
        width: 0.7,
        height: 0.07,
      };
      const info = await addAnnotation(docId, currentPage, {
        kind,
        region,
        contents,
        color,
        opacity: 60,
      });
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      const label = ANNOT_KINDS.find((x) => x.k === kind)?.labelKey ?? "";
      pushToast("info", t("已添加 {kind}", { kind: t(label) }));
      setContents("");
      await reloadAllAnnotations();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (idx: number) => {
    if (docId === null) return;
    setBusy(true);
    try {
      const info = await deleteAnnotation(docId, currentPage, idx);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      await reloadAllAnnotations();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (docId === null) return;
    if (!confirm(t("清空当前页（{n} 个注释）？", { n: list.length }))) return;
    setBusy(true);
    try {
      const info = await clearAnnotations(docId, [currentPage]);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已清空当前页注释"));
      await reloadAllAnnotations();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const exportSummary = async () => {
    if (docId === null) return;
    if (allAnnots.length === 0) {
      pushToast("info", t("文档中还没有注释"));
      return;
    }
    try {
      const lines: string[] = [];
      lines.push(`# ${t("注释摘要")}`, "");
      lines.push(`- ${t("文件")}：${fileName}`);
      lines.push(`- ${t("注释总数")}：${allAnnots.length}`);
      let lastPage = -1;
      for (const a of allAnnots) {
        if (a.pageIndex !== lastPage) {
          lines.push("", `## ${t("第 {n} 页", { n: a.pageIndex + 1 })}`, "");
          lastPage = a.pageIndex;
        }
        lines.push(`- ${kindLabel(a.kind)} · ${a.color} · ${a.contents || t("（无文本）")}`);
      }
      const markdown = `${lines.join("\n")}\n`;
      const base = (fileName || "document").replace(/\.pdf$/i, "");
      const target = await save({
        title: t("选择注释摘要保存位置"),
        defaultPath: `${base}-annotations.md`,
        filters: [{ name: t("Markdown 文档"), extensions: ["md"] }],
      });
      if (typeof target !== "string") return;
      await exportTextFile(target, markdown);
      pushToast("info", t("已导出注释摘要到 {name}", { name: target }));
    } catch (e) {
      errorToast(e);
    }
  };

  const flatten = async () => {
    if (docId === null) return;
    if (allAnnots.length === 0) {
      pushToast("info", t("文档中还没有注释"));
      return;
    }
    if (!confirm(t("确定扁平化注释？合并后注释将无法再单独编辑。"))) return;
    setBusy(true);
    try {
      const info = await flattenAnnotations(docId, []);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(docId));
      pushToast("info", t("已扁平化注释"));
      await reloadAllAnnotations();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="task-body">
      <p className="placeholder">
        {t("第 {n} / {total} 页。点击下方按钮即可在页面顶部插入所选类型的注释。", {
          n: currentPage + 1,
          total: pageCount || "?",
        })}
      </p>
      <div className="annot-kinds">
        {ANNOT_KINDS.map((a) => (
          <button
            key={a.k}
            className={kind === a.k ? "active" : ""}
            onClick={() => setKind(a.k)}
            title={t(a.labelKey)}
          >
            <span style={{ fontSize: 16 }}>{a.icon}</span>
            <br />
            {t(a.labelKey)}
          </button>
        ))}
      </div>
      {(kind === "highlight" ||
        kind === "underline" ||
        kind === "strikeout" ||
        kind === "freeText" ||
        kind === "square") && (
        <div className="form-row">
          <label>{t("颜色")}</label>
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 40, padding: 0, height: 28 }}
          />
        </div>
      )}
      <div className="field">
        <label>{t("备注文本（可选）")}</label>
        <input
          type="text"
          value={contents}
          onChange={(e) => setContents(e.target.value)}
          placeholder={t("如：此处需补充说明")}
        />
      </div>
      <div className="task-footer">
        <button className="btn-primary" onClick={add} disabled={busy || docId === null}>
          {busy ? t("添加中…") : t("添加到当前页")}
        </button>
      </div>

      <div className="annot-list-head">
        <span>{t("本页注释（{n}）", { n: list.length })}</span>
        {list.length > 0 && (
          <button onClick={clearAll} disabled={busy} style={{ color: "var(--danger)" }}>
            {t("清空本页")}
          </button>
        )}
      </div>
      <div className="annot-list">
        {list.length === 0 && <p className="placeholder">{t("本页还没有注释")}</p>}
        {list.map((a) => (
          <div key={a.index} className="annot-item">
            <span className="annot-swatch" style={{ background: a.color }} />
            <span className="annot-kind">{a.kind}</span>
            <span className="annot-contents" title={a.contents}>
              {a.contents || t("（无文本）")}
            </span>
            <button
              onClick={() => remove(a.index)}
              disabled={busy}
              title={t("删除")}
              style={{ color: "var(--danger)" }}
            >
              ✕
            </button>
          </div>
        ))}
      </div>

      <div className="annot-list-head">
        <span>{t("全部注释（{n}）", { n: allAnnots.length })}</span>
        {allAnnots.length > 0 && (
          <span style={{ display: "flex", gap: 8 }}>
            <button onClick={exportSummary} disabled={busy}>
              {t("导出摘要…")}
            </button>
            <button onClick={flatten} disabled={busy} style={{ color: "var(--danger)" }}>
              {t("扁平化注释")}
            </button>
          </span>
        )}
      </div>
      <div className="annot-list">
        {allAnnots.length === 0 && <p className="placeholder">{t("文档中还没有注释")}</p>}
        {allAnnots.map((a) => (
          <div
            key={`${a.pageIndex}-${a.index}`}
            className="annot-item clickable"
            onClick={() => jumpToPage(a.pageIndex)}
            title={t("跳转到第 {n} 页", { n: a.pageIndex + 1 })}
          >
            <span className="annot-page">{a.pageIndex + 1}</span>
            <span className="annot-swatch" style={{ background: a.color }} />
            <span className="annot-kind">{a.kind}</span>
            <span className="annot-contents" title={a.contents}>
              {a.contents || t("（无文本）")}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 输入框文本 → 数字（非法输入回退 0）。 */
const parseNum = (v: string) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

/** 保留一位小数，避免输入框里出现 123.45000000000002。 */
const round1 = (v: number) => Math.round(v * 10) / 10;

function DeepEditor() {
  const docId = useApp((s) => s.docId);
  const currentPage = useApp((s) => s.currentPage);
  const pageCount = useApp((s) => s.pageCount);
  const pages = useApp((s) => s.pages);
  const updatePages = useApp((s) => s.updatePages);
  const markDirty = useApp((s) => s.markDirty);
  const setUndoRedo = useApp((s) => s.setUndoRedo);
  const pushToast = useApp((s) => s.pushToast);
  const errorToast = useApp((s) => s.errorToast);
  const closeTask = useApp((s) => s.closeTask);
  const completedSelection = useApp((s) => s.completedSelection);
  const setCompletedSelection = useApp((s) => s.setCompletedSelection);
  const dblClickText = useApp((s) => s.dblClickText);
  const setDblClickText = useApp((s) => s.setDblClickText);
  const setEditTarget = useApp((s) => s.setEditTarget);
  const jumpToPage = useApp((s) => s.jumpToPage);
  const t = useT();

  // 当前工具与画布浮动胶囊共用 store 状态；切换工具时由 store 同步 selectingFor。
  const mode = useApp((s) => s.editMode);
  const setMode = useApp((s) => s.setEditMode);
  const [busy, setBusy] = useState(false);

  const [region] = useState({
    left: 100,
    bottom: 100,
    right: 300,
    top: 200,
  });
  const [newText] = useState("");
  const [rwFontSize] = useState(24);
  const [rwColor] = useState("#000000");

  const [textInput, setTextInput] = useState("");
  const [tbFontSize, setTbFontSize] = useState(24);
  const [tbColor, setTbColor] = useState("#000000");
  const [tbX, setTbX] = useState(100);
  const [tbY, setTbY] = useState(100);

  const [imgPath, setImgPath] = useState<string | null>(null);
  const [imgName, setImgName] = useState("");
  const [objIndex, setObjIndex] = useState(0);
  // 图片对象的选中与移动/缩放（单位：PDF 点，左下原点）
  const [imgObjects, setImgObjects] = useState<ImageObjectInfo[]>([]);
  const [imgLoading, setImgLoading] = useState(false);
  const [imgL, setImgL] = useState(0);
  const [imgB, setImgB] = useState(0);
  const [imgW, setImgW] = useState(0);
  const [imgH, setImgH] = useState(0);

  const [scanState, setScanState] = useState<"unknown" | "scanned" | "not">("unknown");
  const [detecting, setDetecting] = useState(false);
  const [docScanResult, setDocScanResult] = useState<{
    sampled: number;
    scannedCount: number;
    ratio: number;
  } | null>(null);
  const [docScanning, setDocScanning] = useState(false);

  // 进入图片模式或切换页面时，刷新本页图片对象列表。
  useEffect(() => {
    if (mode !== "image" || docId === null) return;
    let cancelled = false;
    setImgLoading(true);
    listImageObjects(docId, currentPage)
      .then((list) => {
        if (!cancelled) setImgObjects(list);
      })
      .catch((e) => {
        if (!cancelled) errorToast(e);
      })
      .finally(() => {
        if (!cancelled) setImgLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, docId, currentPage]);

  const [rwModal, setRwModal] = useState<{
    region: { left: number; bottom: number; right: number; top: number };
    pageIndex: number;
    originalText?: string;
    /** 双击取字得到的原字体样式，用于预填重写表单。 */
    fontName?: string;
    fontSize?: number;
    color?: string;
  } | null>(null);

  useEffect(() => {
    if (!dblClickText) return;
    if (docId === null) {
      setDblClickText(null);
      return;
    }
    setRwModal({
      region: dblClickText.region,
      pageIndex: dblClickText.pageIndex,
      originalText: dblClickText.originalText,
      fontName: dblClickText.fontName || undefined,
      fontSize: dblClickText.fontSize || undefined,
      color: dblClickText.color || undefined,
    });
    // 不切换工具：双击取字只是打开重写弹窗。若在这里 setMode("rewrite")，
    // 会重新武装 selectingFor，反而挡住后续双击（Canvas.onDoubleClick 首行即 return）。
    if (dblClickText.pageIndex !== currentPage) {
      jumpToPage(dblClickText.pageIndex);
    }
    setDblClickText(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dblClickText]);

  // 重写面板关闭（或本面板因 Escape 卸载）时退出文字编辑态，清掉画布上的虚线框。
  useEffect(() => {
    if (!rwModal) return;
    return () => setEditTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rwModal]);

  useEffect(() => {
    if (!completedSelection || docId === null) return;
    if (!["rewrite", "addText"].includes(completedSelection.mode)) return;
    const sel = completedSelection;
    const pageInfo = pages[sel.pageIndex];
    if (!pageInfo) return;
    const s = sel.scale;
    if (s <= 0) return;
    const pageH_pt = pageInfo.height;
    const left_pt = sel.rect.left / s;
    const top_css = sel.rect.top;
    const right_pt = sel.rect.right / s;
    const bottom_css = sel.rect.bottom;
    const leftPdf = left_pt;
    const rightPdf = right_pt;
    const topPdf = pageH_pt - top_css / s;
    const bottomPdf = pageH_pt - bottom_css / s;

    if (sel.mode === "rewrite") {
      setRwModal({
        region: { left: leftPdf, bottom: bottomPdf, right: rightPdf, top: topPdf },
        pageIndex: sel.pageIndex,
      });
    } else if (sel.mode === "addText") {
      setTbX(Math.round(leftPdf * 10) / 10);
      setTbY(Math.round(bottomPdf * 10) / 10);
      if (sel.pageIndex !== currentPage) {
        jumpToPage(sel.pageIndex);
      }
    }
    setCompletedSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completedSelection]);

  const requireDoc = (): number | null => {
    if (docId === null) {
      pushToast("info", t("请打开文档后再操作"));
      return null;
    }
    return docId;
  };

  const onRewrite = async (opts: {
    region: { left: number; bottom: number; right: number; top: number };
    pageIndex: number;
    newText: string;
    fontSize: number;
    color: string;
    fontName?: string | null;
  }) => {
    const id = requireDoc();
    if (!id) return;
    if (!opts.newText.trim()) {
      pushToast("info", t("文字不能为空"));
      return;
    }
    setBusy(true);
    try {
      const result = await rewriteText(id, opts.pageIndex, opts.region, {
        newText: opts.newText.trim(),
        fontSize: opts.fontSize,
        color: opts.color,
        fontName: opts.fontName ?? null,
      });
      updatePages(result.info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(id));
      pushToast("info", t("已重写第 {n} 页文字", { n: opts.pageIndex + 1 }));
      if (result.approximated) {
        pushToast("info", t("原字体不可用，已用近似字体替换"));
      }
      setRwModal(null);
      closeTask();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const onAddText = async () => {
    const id = requireDoc();
    if (!id) return;
    if (!textInput.trim()) {
      pushToast("info", t("文字不能为空"));
      return;
    }
    setBusy(true);
    try {
      const info = await addTextBox(id, currentPage, {
        text: textInput.trim(),
        fontSize: tbFontSize,
        color: tbColor,
        x: tbX,
        y: tbY,
      });
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(id));
      pushToast("info", t("已添加文本"));
      closeTask();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const pickImage = async () => {
    const picked = await open({
      multiple: false,
      filters: [
        {
          name: t("图片"),
          extensions: ["png", "jpg", "jpeg", "webp", "bmp"],
        },
      ],
    });
    if (typeof picked === "string") {
      setImgPath(picked);
      setImgName(picked.split(/[\\/]/).pop() || picked);
    }
  };

  const onReplaceImage = async () => {
    const id = requireDoc();
    if (!id) return;
    if (!imgPath) {
      pushToast("info", t("请选择一张图片"));
      return;
    }
    setBusy(true);
    try {
      const info = await replaceImage(id, currentPage, objIndex, imgPath);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(id));
      pushToast("info", t("已替换图片"));
      closeTask();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const onDeleteImage = async () => {
    const id = requireDoc();
    if (!id) return;
    if (!confirm(t("删除第 {n} 页的对象 {i}？", { n: currentPage + 1, i: objIndex }))) {
      return;
    }
    setBusy(true);
    try {
      const info = await deleteImageObject(id, currentPage, objIndex);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(id));
      pushToast("info", t("已删除图片"));
      closeTask();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  /** 选中一个图片对象，并把其当前包围盒填入 X/Y/宽/高 输入框。 */
  const selectImageObject = (o: ImageObjectInfo) => {
    setObjIndex(o.objectIndex);
    setImgL(round1(o.left));
    setImgB(round1(o.bottom));
    setImgW(round1(o.right - o.left));
    setImgH(round1(o.top - o.bottom));
  };

  const onApplyImageBounds = async () => {
    const id = requireDoc();
    if (!id) return;
    setBusy(true);
    try {
      const info = await setImageBounds(id, currentPage, objIndex, {
        left: imgL,
        bottom: imgB,
        right: imgL + imgW,
        top: imgB + imgH,
      });
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(id));
      pushToast("info", t("已应用图片位置"));
      setImgObjects(await listImageObjects(id, currentPage));
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const onClearPageText = async () => {
    const id = requireDoc();
    if (!id) return;
    if (!confirm(t("清空第 {n} 页所有文字对象？图片和其他对象保留。", { n: currentPage + 1 }))) {
      return;
    }
    setBusy(true);
    try {
      const info = await clearPageText(id, [currentPage]);
      updatePages(info);
      markDirty(true);
      setUndoRedo(await refreshUndoRedo(id));
      pushToast("info", t("已清空页面文字"));
      closeTask();
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const onDetect = async () => {
    const id = requireDoc();
    if (!id) return;
    setDetecting(true);
    try {
      const scanned = await isScannedPage(id, currentPage);
      setScanState(scanned ? "scanned" : "not");
    } catch (e) {
      errorToast(e);
    } finally {
      setDetecting(false);
    }
  };

  const onDetectDocument = async () => {
    const id = requireDoc();
    if (!id) return;
    setDocScanning(true);
    try {
      const total = pageCount;
      const sampleSize = Math.min(10, total);
      const step = total <= sampleSize ? 1 : Math.floor(total / sampleSize);
      const indices: number[] = [];
      for (let i = 0; i < sampleSize; i++) {
        indices.push(Math.min(i * step, total - 1));
      }
      let scannedCount = 0;
      for (const idx of indices) {
        if (await isScannedPage(id, idx)) scannedCount++;
      }
      setDocScanResult({
        sampled: indices.length,
        scannedCount,
        ratio: indices.length > 0 ? scannedCount / indices.length : 0,
      });
    } catch (e) {
      errorToast(e);
    } finally {
      setDocScanning(false);
    }
  };

  // rwModal 打开时渲染 RewriteModal，否则渲染主 UI
  if (rwModal) {
    const modal = rwModal;
    return (
      <RewriteModal
        region={modal.region}
        pageIndex={modal.pageIndex}
        originalText={modal.originalText}
        fontName={modal.fontName}
        fontSize={modal.fontSize}
        color={modal.color}
        onCancel={() => setRwModal(null)}
        onSubmit={(opts) => {
          onRewrite({
            region: modal.region,
            pageIndex: modal.pageIndex,
            newText: opts.newText,
            fontSize: opts.fontSize,
            color: opts.color,
            fontName: opts.fontName,
          });
        }}
        busy={busy}
      />
    );
  }

  return (
    <div className="task-body">
      <p className="placeholder">
        {t("第 {n} / {total} 页。", {
          n: currentPage + 1,
          total: pageCount || "?",
        })}
      </p>
      <div className="split-modes">
        <label className={`split-mode${mode === "rewrite" ? " active" : ""}`}>
          <input
            type="radio"
            checked={mode === "rewrite"}
            onChange={() => setMode("rewrite")}
            style={{ display: "none" }}
          />
          {t("文字重写")}
        </label>
        <label className={`split-mode${mode === "addtext" ? " active" : ""}`}>
          <input
            type="radio"
            checked={mode === "addtext"}
            onChange={() => setMode("addtext")}
            style={{ display: "none" }}
          />
          {t("新增文本")}
        </label>
        <label className={`split-mode${mode === "image" ? " active" : ""}`}>
          <input
            type="radio"
            checked={mode === "image"}
            onChange={() => setMode("image")}
            style={{ display: "none" }}
          />
          {t("图片")}
        </label>
        <label className={`split-mode${mode === "scandetect" ? " active" : ""}`}>
          <input
            type="radio"
            checked={mode === "scandetect"}
            onChange={() => setMode("scandetect")}
            style={{ display: "none" }}
          />
          {t("扫描版")}
        </label>
      </div>

      {mode === "select" && (
        <p className="placeholder" style={{ fontSize: 11 }}>
          {t(
            "选择态：双击画布上的文字即可编辑；要框选重写或放置文本，请点「编辑」「文字」，或使用画布底部工具条。",
          )}
        </p>
      )}

      {scanState === "scanned" && (
        <div
          style={{
            background: "var(--danger-bg, rgba(255,80,80,0.15))",
            border: "1px solid var(--danger)",
            borderRadius: 4,
            padding: 8,
            marginBottom: 8,
            fontSize: 12,
          }}
        >
          {t("扫描版提示")}
        </div>
      )}

      {mode === "rewrite" && (
        <>
          <p
            className="placeholder"
            style={{
              fontSize: 11,
              background: "var(--accent-bg, rgba(0,103,192,0.08))",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              padding: 8,
            }}
          >
            {t("操作说明：在画布上用鼠标拖拽矩形选中要重写的文字区域 → 松开后弹出输入框。")}
          </p>
          <p className="placeholder" style={{ fontSize: 11 }}>
            {t(
              "文字重写操作会用白色矩形覆盖原文字区域，然后按指定字号插入新文字；字体缺失时会自动回退到系统中文字体。",
            )}
          </p>
          <div className="field">
            <label>{t("矩形（PDF 点，左下原点）")}</label>
          </div>
          <div className="form-row">
            <label>{t("左")}</label>
            <input
              type="number"
              value={region.left}
              onChange={(e) => e.target as unknown as { value: number }}
              style={{ width: 70 }}
            />
            <label>{t("下")}</label>
            <input
              type="number"
              value={region.bottom}
              onChange={(e) => e.target as unknown as { value: number }}
              style={{ width: 70 }}
            />
          </div>
          <div className="form-row">
            <label>{t("右")}</label>
            <input
              type="number"
              value={region.right}
              onChange={(e) => e.target as unknown as { value: number }}
              style={{ width: 70 }}
            />
            <label>{t("上")}</label>
            <input
              type="number"
              value={region.top}
              onChange={(e) => e.target as unknown as { value: number }}
              style={{ width: 70 }}
            />
          </div>
          <div className="task-footer">
            <button
              className="btn-primary"
              onClick={() =>
                onRewrite({
                  region,
                  pageIndex: currentPage,
                  newText,
                  fontSize: rwFontSize,
                  color: rwColor,
                })
              }
              disabled={busy || !newText.trim() || docId === null}
            >
              {busy ? t("处理中…") : t("确认重写")}
            </button>
          </div>
        </>
      )}

      {mode === "addtext" && (
        <>
          <p className="placeholder" style={{ fontSize: 11 }}>
            {t("🎯 点击画布任意位置即可设置文本插入点，也可手动输入坐标。")}
          </p>
          <div className="form-row">
            <label>{t("新文本内容")}</label>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={t("如：批注文字")}
            />
          </div>
          <div className="form-row">
            <label>{t("字号（pt）")}</label>
            <input
              type="number"
              min={8}
              max={200}
              value={tbFontSize}
              onChange={(e) =>
                setTbFontSize(Math.min(200, Math.max(8, parseInt(e.target.value) || 24)))
              }
              style={{ width: 64 }}
            />
            <label>{t("颜色")}</label>
            <input
              type="color"
              value={tbColor}
              onChange={(e) => setTbColor(e.target.value)}
              style={{ width: 40, padding: 0, height: 28 }}
            />
          </div>
          <div className="form-row">
            <label>{t("X 坐标（pt）")}</label>
            <input
              type="number"
              value={tbX}
              onChange={(e) => setTbX(parseFloat(e.target.value) || 0)}
              style={{ width: 90 }}
            />
          </div>
          <div className="form-row">
            <label>{t("Y 坐标（pt）")}</label>
            <input
              type="number"
              value={tbY}
              onChange={(e) => setTbY(parseFloat(e.target.value) || 0)}
              style={{ width: 90 }}
            />
          </div>
          <div className="task-footer">
            <button
              className="btn-primary"
              onClick={onAddText}
              disabled={busy || !textInput.trim() || docId === null}
            >
              {busy ? t("添加中…") : t("添加文本框")}
            </button>
          </div>
        </>
      )}

      {mode === "image" && (
        <>
          <p className="placeholder" style={{ fontSize: 11 }}>
            {t("选中图片后可移动/缩放，也可替换整张图片或删除该对象。")}
          </p>
          <div className="form-row">
            <label>{t("本页图片")}</label>
            <span className="placeholder" style={{ fontSize: 11 }}>
              {imgLoading
                ? t("加载中…")
                : imgObjects.length === 0
                  ? t("本页没有图片对象")
                  : t("共 {n} 个，点击选中", { n: imgObjects.length })}
            </span>
          </div>
          {imgObjects.length > 0 && (
            <div className="merge-output" style={{ flexWrap: "wrap", gap: 4 }}>
              {imgObjects.map((o) => (
                <button
                  key={o.objectIndex}
                  onClick={() => selectImageObject(o)}
                  disabled={busy}
                  className={o.objectIndex === objIndex ? "btn-primary" : undefined}
                  title={`L${round1(o.left)} B${round1(o.bottom)} → R${round1(
                    o.right,
                  )} T${round1(o.top)}`}
                >
                  #{o.objectIndex}
                </button>
              ))}
            </div>
          )}
          <div className="form-row">
            <label>{t("X（左，pt）")}</label>
            <input
              type="number"
              value={imgL}
              onChange={(e) => setImgL(parseNum(e.target.value))}
              style={{ width: 80 }}
            />
            <label>{t("Y（下，pt）")}</label>
            <input
              type="number"
              value={imgB}
              onChange={(e) => setImgB(parseNum(e.target.value))}
              style={{ width: 80 }}
            />
          </div>
          <div className="form-row">
            <label>{t("宽（pt）")}</label>
            <input
              type="number"
              min={0}
              value={imgW}
              onChange={(e) => setImgW(parseNum(e.target.value))}
              style={{ width: 80 }}
            />
            <label>{t("高（pt）")}</label>
            <input
              type="number"
              min={0}
              value={imgH}
              onChange={(e) => setImgH(parseNum(e.target.value))}
              style={{ width: 80 }}
            />
          </div>
          <button
            className="btn-primary"
            onClick={onApplyImageBounds}
            disabled={busy || docId === null || imgW <= 0 || imgH <= 0}
          >
            {busy ? t("应用中…") : t("应用移动/缩放")}
          </button>
          <div className="form-row" style={{ marginTop: 12 }}>
            <label>{t("对象索引")}</label>
            <input
              type="number"
              min={0}
              value={objIndex}
              onChange={(e) => setObjIndex(Math.max(0, parseInt(e.target.value) || 0))}
              style={{ width: 80 }}
            />
          </div>
          <div className="merge-output">
            <button onClick={pickImage} disabled={busy}>
              {t("替换为新图片…")}
            </button>
            <span className="merge-output-path" title={imgPath ?? undefined}>
              {imgName || t("未选择")}
            </span>
            {imgPath && (
              <button
                onClick={() => {
                  setImgPath(null);
                  setImgName("");
                }}
                disabled={busy}
              >
                ✕
              </button>
            )}
          </div>
          <div className="task-footer">
            <button
              className="btn-primary"
              onClick={onReplaceImage}
              disabled={busy || !imgPath || docId === null}
            >
              {busy ? t("替换中…") : t("替换图片")}
            </button>
            <button
              onClick={onDeleteImage}
              disabled={busy || docId === null}
              style={{ marginLeft: 6, color: "var(--danger)" }}
            >
              {busy ? t("删除中…") : t("删除图片")}
            </button>
          </div>
          <button
            onClick={onClearPageText}
            disabled={busy || docId === null}
            style={{ marginTop: 12, color: "var(--danger)" }}
          >
            {t("清空页面文字（仅当前页）")}
          </button>
        </>
      )}

      {mode === "scandetect" && (
        <>
          <p className="placeholder" style={{ fontSize: 11 }}>
            {t("扫描版检测：判断页面是否几乎没有可识别文本（无文本层）。")}
          </p>
          <div className="task-footer" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn-primary"
              onClick={onDetect}
              disabled={detecting || docId === null}
            >
              {detecting ? t("正在检测…") : t("已扫描检测")}
            </button>
            <button onClick={onDetectDocument} disabled={docScanning || docId === null}>
              {docScanning ? t("正在检测…") : t("全文档抽样检测")}
            </button>
          </div>
          {scanState !== "unknown" && (
            <div style={{ marginTop: 12, fontSize: 13 }}>
              {t("本页面是否为扫描版")}：
              <span
                style={{
                  color: scanState === "scanned" ? "var(--danger)" : "var(--accent)",
                  fontWeight: 600,
                  marginLeft: 6,
                }}
              >
                {scanState === "scanned" ? t("是") : t("否")}
              </span>
            </div>
          )}
          {docScanResult && (
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                padding: 8,
                background: "var(--bg-soft)",
                border: "1px solid var(--border)",
                borderRadius: 4,
              }}
            >
              <div>
                {t("抽样 {n} 页，扫描版 {m} 页（{pct}%）", {
                  n: docScanResult.sampled,
                  m: docScanResult.scannedCount,
                  pct: Math.round(docScanResult.ratio * 100),
                })}
              </div>
              {docScanResult.ratio >= 0.5 && (
                <div
                  style={{
                    marginTop: 6,
                    color: "var(--danger)",
                    fontSize: 12,
                  }}
                >
                  {t("扫描版提示")}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RewriteModal({
  region,
  pageIndex,
  originalText,
  fontName,
  fontSize: originalFontSize,
  color: originalColor,
  onCancel,
  onSubmit,
  busy,
}: {
  region: { left: number; bottom: number; right: number; top: number };
  pageIndex: number;
  originalText?: string;
  fontName?: string;
  fontSize?: number;
  color?: string;
  onCancel: () => void;
  onSubmit: (opts: { newText: string; fontSize: number; color: string; fontName?: string }) => void;
  busy: boolean;
}) {
  const t = useT();
  const [text, setText] = useState(originalText ?? "");
  const [fontSize, setFontSize] = useState(() =>
    originalFontSize ? Math.round(originalFontSize * 10) / 10 : 24,
  );
  const [color, setColor] = useState(originalColor || "#000000");
  const width = region.right - region.left;
  const height = region.top - region.bottom;
  return (
    <div className="task-body">
      <h3 style={{ margin: "0 0 12px 0" }}>{t("已选区 · 第 {n} 页", { n: pageIndex + 1 })}</h3>
      <p className="placeholder" style={{ fontSize: 12 }}>
        {t("矩形")}：{region.left.toFixed(1)}, {region.bottom.toFixed(1)} –{" "}
        {region.right.toFixed(1)}, {region.top.toFixed(1)}
        {" · "}
        {width.toFixed(1)}×{height.toFixed(1)} pt
      </p>
      {originalText && (
        <p
          style={{
            fontSize: 12,
            background: "var(--accent-bg, rgba(0,103,192,0.08))",
            border: "1px solid var(--accent)",
            borderRadius: 4,
            padding: "6px 8px",
            margin: "0 0 8px 0",
            wordBreak: "break-all",
          }}
        >
          <strong>{t("原文")}：</strong>
          <span>{originalText}</span>
        </p>
      )}
      {fontName && (
        <p className="placeholder" style={{ fontSize: 12, margin: "0 0 8px 0" }}>
          {t("原字体")}：{fontName}
        </p>
      )}
      <div className="form-row">
        <label>{t("新文本内容")}</label>
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("如：修正后的标题")}
          autoFocus
        />
      </div>
      <div className="form-row">
        <label>{t("字号（pt）")}</label>
        <input
          type="number"
          min={8}
          max={200}
          value={fontSize}
          onChange={(e) => setFontSize(Math.min(200, Math.max(8, parseInt(e.target.value) || 24)))}
          style={{ width: 64 }}
        />
        <label>{t("颜色")}</label>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ width: 40, padding: 0, height: 28 }}
        />
      </div>
      <div className="task-footer">
        <button
          className="btn-primary"
          onClick={() => onSubmit({ newText: text, fontSize, color, fontName })}
          disabled={busy || !text.trim()}
        >
          {busy ? t("处理中…") : t("确认重写")}
        </button>
        <button onClick={onCancel} disabled={busy} style={{ marginLeft: 6 }}>
          {t("取消")}
        </button>
      </div>
    </div>
  );
}
