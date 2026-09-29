import { useApp } from "../state/store";
import type { TaskId } from "../state/store";
import { useT } from "../i18n";
import MergePanel from "./panels/MergePanel";
import SplitPanel from "./panels/SplitPanel";
import SecurityPanel from "./panels/SecurityPanel";
import OcrPanel from "./panels/OcrPanel";
import FormPanel from "./panels/FormPanel";
import DiagnosePanel from "./panels/DiagnosePanel";
import WatermarkPanel from "./panels/WatermarkPanel";
import ConvertPanel from "./panels/ConvertPanel";
import EditPanel from "./panels/EditPanel";

export default function TaskPanel() {
  const task = useApp((s) => s.task);
  const closeTask = useApp((s) => s.closeTask);
  const t = useT();

  const TITLES: Record<Exclude<TaskId, null>, string> = {
    merge: t("合并文档"),
    split: t("拆分文档"),
    watermark: t("水印"),
    edit: t("内容编辑"),
    security: t("文档安全"),
    export: t("导出图片"),
    diagnose: t("文档诊断"),
    ocr: t("扫描版 OCR"),
    forms: t("表单字段"),
  };

  const DESC: Record<Exclude<TaskId, null>, string> = {
    merge: t("将多个 PDF 按顺序合并为一个文档，可对每个文件选择页码范围。"),
    split: t("按固定页数、自定义范围或书签层级，将文档拆分为多个文件。"),
    watermark: t("为页面添加文字或图片水印，支持位置、透明度与平铺。"),
    edit: t("为当前页添加 PDF 注释：高亮、下划线、删除线、便签、自由文本框、矩形标注。"),
    security: t(
      "查看文档加密状态与权限矩阵；导出明文副本、在内存中去除加密，或设置打开密码与权限密码另存为加密副本。",
    ),
    export: t(
      "PDF 与图片互转：PDF → PNG/JPEG（按页可调 DPI）；PNG/JPG/JPEG/BMP/WebP → PDF（多图合并）。",
    ),
    diagnose: t("查看文档关键统计：页数、文件大小、加密状态、注释总数、扫描版抽样。"),
    ocr: t(
      "对扫描版 PDF 调用 Tesseract 识别文字，并把结果作为不可见文本层写回，生成可搜索 PDF。需要编译时启用 ocr feature。",
    ),
    forms: t("列出 PDF 表单（AcroForm）字段并填写新值，保存后立即写入文档。"),
  };

  if (task === null) return null;

  return (
    <aside className="task">
      <h3>
        <span>{TITLES[task]}</span>
        <button title={t("关闭面板")} onClick={closeTask}>
          ✕
        </button>
      </h3>
      <div className="body">
        {task === "merge" && <MergePanel />}
        {task === "split" && <SplitPanel />}
        {task === "watermark" && <WatermarkPanel />}
        {task === "edit" && <EditPanel />}
        {task === "security" && <SecurityPanel />}
        {task === "export" && <ConvertPanel />}
        {task === "diagnose" && <DiagnosePanel />}
        {task === "ocr" && <OcrPanel />}
        {task === "forms" && <FormPanel />}
        {task !== "merge" &&
          task !== "split" &&
          task !== "watermark" &&
          task !== "edit" &&
          task !== "security" &&
          task !== "export" &&
          task !== "diagnose" &&
          task !== "ocr" &&
          task !== "forms" && (
            <>
              <p className="placeholder">{DESC[task]}</p>
              <p className="placeholder" style={{ marginTop: 12 }}>
                {t("该功能将在后续里程碑（M4–M6）中交付。")}
              </p>
            </>
          )}
      </div>
    </aside>
  );
}
