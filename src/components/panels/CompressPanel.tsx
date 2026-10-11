import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { useApp } from "../../state/store";
import { useT } from "../../i18n";
import { compressDocument, isApiError } from "../../lib/ipc";
import type { CompressLevel, CompressResult } from "../../lib/ipc";

const LEVELS: { id: CompressLevel; labelKey: string; descKey: string }[] = [
  {
    id: "light",
    labelKey: "轻度（仅结构优化）",
    descKey: "压缩未压缩流并清理冗余对象，不改变图片质量，速度最快。",
  },
  {
    id: "standard",
    labelKey: "标准（推荐）",
    descKey: "在结构优化基础上，把图片最长边限制到 1600 像素并重编码，体积与清晰度较均衡。",
  },
  {
    id: "strong",
    labelKey: "强力",
    descKey: "把图片最长边限制到 1024 像素、画质更低，体积最小，适合屏幕阅读。",
  },
];

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

export default function CompressPanel() {
  const docId = useApp((s) => s.docId);
  const fileSizeBytes = useApp((s) => s.fileSizeBytes);
  const pushToast = useApp((s) => s.pushToast);
  const errorToast = useApp((s) => s.errorToast);
  const t = useT();

  const [level, setLevel] = useState<CompressLevel>("standard");
  const [openPw, setOpenPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CompressResult | null>(null);

  useEffect(() => {
    setLevel("standard");
    setOpenPw("");
    setResult(null);
  }, [docId]);

  const onCompress = async () => {
    if (docId === null) return;
    const p = await save({
      title: t("压缩另存为"),
      defaultPath: "compressed.pdf",
      filters: [{ name: t("PDF 文档"), extensions: ["pdf"] }],
    });
    if (!p) return;
    setBusy(true);
    try {
      const info = await compressDocument(docId, p, level, openPw);
      setResult(info);
      pushToast("info", t("已压缩另存：{path}", { path: p }));
    } catch (e) {
      if (isApiError(e) && e.code === "password") {
        pushToast("error", t("该文档已加密，请填写现有打开密码后重试"));
      } else {
        errorToast(e);
      }
    } finally {
      setBusy(false);
    }
  };

  const saved =
    result && result.originalSize > 0
      ? Math.max(0, Math.round((1 - result.compressedSize / result.originalSize) * 100))
      : null;

  return (
    <div className="task-body">
      <p className="placeholder">
        {t(
          "压缩当前文档并另存为新文件。压缩只作用于落盘副本，内存中的文档与编辑状态不受影响。",
        )}
      </p>

      {docId !== null && (
        <p className="placeholder">
          {t("当前文档大小：{size}", { size: fmtSize(fileSizeBytes) })}
        </p>
      )}

      <div className="field">
        <label>{t("压缩档位")}</label>
        <div className="compress-levels">
          {LEVELS.map((item) => (
            <label key={item.id} className="compress-level">
              <input
                type="radio"
                name="compress-level"
                checked={level === item.id}
                onChange={() => setLevel(item.id)}
                disabled={busy}
              />
              <span className="compress-level-label">{t(item.labelKey)}</span>
            </label>
          ))}
        </div>
        <p className="placeholder">{t(LEVELS.find((l) => l.id === level)!.descKey)}</p>
      </div>

      <div className="field">
        <label htmlFor="compress-open-pw">{t("加密文档的打开密码（未加密可留空）")}</label>
        <input
          id="compress-open-pw"
          type="password"
          autoComplete="current-password"
          value={openPw}
          onChange={(e) => setOpenPw(e.target.value)}
          disabled={busy}
        />
      </div>

      {result && (
        <div className="compress-result">
          <div className="compress-result-row">
            <span>{t("压缩前")}</span>
            <span>{fmtSize(result.originalSize)}</span>
          </div>
          <div className="compress-result-row">
            <span>{t("压缩后")}</span>
            <span>{fmtSize(result.compressedSize)}</span>
          </div>
          {saved !== null && (
            <div className="compress-result-row">
              <span>{t("体积变化")}</span>
              <span>{saved > 0 ? t("减少 {percent}%", { percent: saved }) : t("基本不变")}</span>
            </div>
          )}
        </div>
      )}

      <div className="task-footer">
        <button className="btn-primary" onClick={onCompress} disabled={busy || docId === null}>
          {busy ? t("压缩中…") : t("压缩另存为…")}
        </button>
      </div>
    </div>
  );
}
