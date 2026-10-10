import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApp } from "../state/store";
import { useT } from "../i18n";
import { useAppVersion } from "../hooks/useAppVersion";
import { FEATURE_KEYS } from "./HelpPanel";

// Microsoft Store 产品页；应用更新走 Store 自带机制，不自建更新器
const STORE_URL = "https://apps.microsoft.com/detail/9PC0GZ78MFC41";

export default function AboutDialog() {
  const aboutOpen = useApp((s) => s.aboutOpen);
  const setAboutOpen = useApp((s) => s.setAboutOpen);
  const t = useT();
  const version = useAppVersion();
  const [failed, setFailed] = useState(false);

  if (!aboutOpen) return null;

  const onCheckUpdate = () => {
    setFailed(false);
    openUrl(STORE_URL).catch(() => setFailed(true));
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 300,
      }}
      onClick={() => setAboutOpen(false)}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          borderRadius: 10,
          padding: 24,
          width: 640,
          maxHeight: "85vh",
          overflow: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0 }}>{t("关于 PDFe")}</h2>
          <button onClick={() => setAboutOpen(false)} title={t("关闭（Esc）")}>
            ✕
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
          <span style={{ fontSize: 26, fontWeight: 700, color: "var(--accent)" }}>PDFe</span>
          <span style={{ fontSize: 13, color: "var(--fg-dim)" }}>{t("本地 PDF 阅读与编辑工具")}</span>
        </div>
        <p style={{ margin: "0 0 18px", fontSize: 13, lineHeight: 1.6, color: "var(--fg)" }}>
          {t(
            "完全在你的本机运行，专注于 PDF 阅读、页面管理、水印、注释、文档安全与格式互转，不包含联网功能。",
          )}
        </p>

        <h3 style={{ marginTop: 0, marginBottom: 8 }}>{t("版本信息")}</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <tbody>
            <tr>
              <td style={{ padding: "3px 6px 3px 0", color: "var(--fg-dim)", whiteSpace: "nowrap" }}>
                {t("版本号")}
              </td>
              <td style={{ padding: "3px 6px", color: "var(--fg)", fontFamily: "Consolas, monospace" }}>
                {version ? `v${version}` : "—"}
              </td>
            </tr>
            <tr>
              <td style={{ padding: "3px 6px 3px 0", color: "var(--fg-dim)", whiteSpace: "nowrap" }}>
                {t("更新方式")}
              </td>
              <td style={{ padding: "3px 6px", color: "var(--fg)" }}>
                {t("通过 Microsoft Store 分发")}
              </td>
            </tr>
          </tbody>
        </table>

        <h3 style={{ marginTop: 20, marginBottom: 8 }}>{t("在线升级")}</h3>
        <p style={{ margin: "0 0 10px", fontSize: 13, lineHeight: 1.6, color: "var(--fg)" }}>
          {t(
            "应用更新通过 Microsoft Store 自动分发。点击下方按钮打开商店页面，即可获取并安装最新版本。",
          )}
        </p>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onCheckUpdate}>{t("检查更新")}</button>
          {failed && (
            <span style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              {t("打开商店页面失败，请手动访问 Microsoft Store。")}
            </span>
          )}
        </div>

        <h3 style={{ marginTop: 20, marginBottom: 8 }}>{t("功能清单")}</h3>
        {FEATURE_KEYS.map((g) => (
          <div key={g.groupKey} style={{ marginBottom: 14 }}>
            <div style={{ color: "var(--fg-dim)", fontSize: 12, marginBottom: 4 }}>
              {t(g.groupKey)}
            </div>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {g.items.map((it) => (
                <li
                  key={it}
                  style={{ margin: "3px 0", color: "var(--fg)", fontSize: 13, lineHeight: 1.5 }}
                >
                  {t(it)}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <p
          style={{
            margin: "16px 0 0",
            padding: "10px 12px",
            background: "var(--bg)",
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.6,
            color: "var(--fg-dim)",
          }}
        >
          {t(
            "PDFe 完全在你的本机运行，不包含联网功能，不收集、不上传、不共享你的个人信息或文档内容。",
          )}
        </p>
      </div>
    </div>
  );
}
