import { useApp } from "../state/store";
import { useT } from "../i18n";
import { useAppVersion } from "../hooks/useAppVersion";

const SHORTCUT_KEYS = [
  {
    groupKey: "文件与文档",
    items: [
      { keys: "Ctrl + O", descKey: "打开 PDF" },
      { keys: "Ctrl + S", descKey: "保存到磁盘" },
      { keys: "F1 / ?", descKey: "打开帮助面板" },
    ],
  },
  {
    groupKey: "导航",
    items: [
      { keys: "PageDown / PageUp / Space", descKey: "下一页 / 上一页" },
      { keys: "Home / End", descKey: "跳到首页 / 末页" },
      { keys: "Ctrl + G", descKey: "切换左侧面板可见性" },
      { keys: "F3 / Ctrl + F", descKey: "打开搜索" },
      { keys: "Esc", descKey: "关闭搜索/任务面板/帮助" },
    ],
  },
  {
    groupKey: "视图",
    items: [
      { keys: "Ctrl + +", descKey: "放大" },
      { keys: "Ctrl + -", descKey: "缩小" },
      { keys: "Ctrl + 滚轮", descKey: "以光标为中心缩放" },
      { keys: "Ctrl + 0", descKey: "重置为适应宽度" },
      { keys: "Ctrl + 1", descKey: "连续滚动视图" },
      { keys: "Ctrl + 2", descKey: "单页视图" },
      { keys: "Ctrl + 3", descKey: "双页对开视图" },
    ],
  },
  {
    groupKey: "编辑操作",
    items: [
      { keys: "Ctrl + Z", descKey: "撤销" },
      { keys: "Ctrl + Y", descKey: "重做" },
      { keys: "Ctrl + Shift + Z", descKey: "重做（备用）" },
    ],
  },
  {
    groupKey: "界面",
    items: [{ keys: "Ctrl + Shift + L", descKey: "切换界面语言" }],
  },
];

const FEATURE_KEYS = [
  {
    groupKey: "文档核心",
    items: [
      "打开 / 保存 PDF（自动加密解密支持）",
      "全文搜索（命中跨页 flash 高亮）",
      "页面缩略图 + 书签导航",
      "阅读位置记忆（自动恢复上次阅读页）",
    ],
  },
  {
    groupKey: "页面管理（M3）",
    items: [
      "旋转 / 删除 / 复制 / 插入空白页",
      "拖拽缩略图重排",
      "合并多个 PDF（按文件可选页范围）",
      "拆分 PDF（每 N 页 / 自定义范围 / 按书签 / 选中页）",
    ],
  },
  {
    groupKey: "水印（M4）",
    items: [
      "文字水印（字号 / 颜色 / 字体回退到系统中文字体）",
      "图片水印（任意 png/jpg/webp/bmp）",
      "九宫格定位 / 平铺 / 旋转 / 透明度",
      "即时预览（添加后画布立刻刷新）",
      "水印去除：手动矩形框选 / 自动检测跨页重复对象",
    ],
  },
  {
    groupKey: "注释（M5）",
    items: [
      "高亮 / 下划线 / 删除线",
      "便签 / 自由文本框 / 矩形标注",
      "可附备注文本，支持按页面增删",
      "深度编辑：文字遮盖重写 / 新增文本 / 图片替换删除 / 扫描版检测",
    ],
  },
  {
    groupKey: "文档安全（M6）",
    items: [
      "查看加密状态与 8 项权限",
      "导出明文副本 / 在内存中去除加密",
      "注意：pdfium 仅支持读取，密码设置需外部工具",
    ],
  },
  {
    groupKey: "格式互转（M7–M10）",
    items: [
      "PDF ↔ PNG / JPEG（PDF→图按 DPI；图→PDF 多图合并）",
      "Office → PDF（依赖 LibreOffice）",
      "EPUB / MOBI / AZW3 / FB2 / HTML / RTF → PDF（依赖 Calibre）",
      "PDF → Office / 电子书不在范围",
    ],
  },
];

// 应用内隐私声明：逐条对应 docs/store-listing/privacy-policy.md，改动任一侧须同步另一侧
const PRIVACY_KEYS = [
  "文档只在你本机读取、处理和保存，不发送到任何服务器。",
  "不含遥测、分析、广告或埋点 SDK；无需注册或登录，也不收集文档内容与文件名。",
  "不申请摄像头、麦克风、位置、通讯录等任何 Windows 受限权限，仅声明 runFullTrust。",
  "仅在本机保存阅读位置与界面语言两项设置，不保存文档副本，卸载应用即清除。",
  "只在你主动保存或导出时写文件，且一律写到你用系统对话框指定的位置。",
  "内置 PDFium 等组件均离线运行；可选 OCR 在默认发布版本中未启用。",
];

export default function HelpPanel() {
  const helpOpen = useApp((s) => s.helpOpen);
  const setHelpOpen = useApp((s) => s.setHelpOpen);
  const t = useT();
  const version = useAppVersion();

  if (!helpOpen) return null;

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
      onClick={() => setHelpOpen(false)}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          borderRadius: 10,
          padding: 24,
          width: 720,
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
          <h2 style={{ margin: 0 }}>
            {t("PDFe 帮助")}
            {version && (
              <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 400, color: "var(--fg-dim)" }}>
                v{version}
              </span>
            )}
          </h2>
          <button onClick={() => setHelpOpen(false)} title={t("关闭（Esc）")}>
            ✕
          </button>
        </div>

        <h3 style={{ marginTop: 12, marginBottom: 8 }}>{t("快捷键")}</h3>
        {SHORTCUT_KEYS.map((g) => (
          <div key={g.groupKey} style={{ marginBottom: 14 }}>
            <div style={{ color: "var(--fg-dim)", fontSize: 12, marginBottom: 4 }}>
              {t(g.groupKey)}
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {g.items.map((s) => (
                  <tr key={s.descKey}>
                    <td
                      style={{
                        padding: "3px 6px",
                        color: "var(--accent)",
                        fontFamily: "Consolas, monospace",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {s.keys}
                    </td>
                    <td style={{ padding: "3px 6px", color: "var(--fg-dim)" }}>{t(s.descKey)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

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

        <h3 style={{ marginTop: 20, marginBottom: 8 }}>{t("隐私声明")}</h3>
        <p style={{ margin: "0 0 8px", fontSize: 13, lineHeight: 1.6, color: "var(--fg)" }}>
          {t(
            "PDFe 完全在你的本机运行，不包含联网功能，不收集、不上传、不共享你的个人信息或文档内容。",
          )}
        </p>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {PRIVACY_KEYS.map((it) => (
            <li
              key={it}
              style={{ margin: "3px 0", color: "var(--fg)", fontSize: 13, lineHeight: 1.5 }}
            >
              {t(it)}
            </li>
          ))}
        </ul>

        <div
          style={{
            marginTop: 24,
            padding: "10px 12px",
            background: "var(--bg)",
            borderRadius: 6,
            fontSize: 12,
            color: "var(--fg-dim)",
          }}
        >
          💡 {t("💡 提示：按 F1 或 ? 随时打开此面板；按 Esc 关闭。")}
        </div>
      </div>
    </div>
  );
}
