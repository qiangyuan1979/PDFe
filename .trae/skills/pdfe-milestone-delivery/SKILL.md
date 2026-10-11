---
name: pdfe-milestone-delivery
description: Delivers PDFe (Tauri 2 + React + TS + Rust + pdfium-render 0.8.37) milestone features end-to-end, including backend commands, frontend IPC/store/UI, tests, and validation. Use when the user asks to develop new PDFe features, add capabilities, or build milestones. Do not use for one-off bug fixes or doc-only changes.
---

# PDFe 里程碑交付

为 PDFe（Windows PDF 编辑器，Tauri 2 + React + TS + Rust + pdfium-render 0.8.37）按端到端交付新功能里程碑。

## 项目结构速查

```
src/                          # 前端（React + TS）
  components/
    Canvas.tsx               # 画布 + 页面渲染 + 选区 + 搜索高亮
    Toolbar.tsx              # 顶部工具栏
    SearchPanel.tsx          # 搜索面板
    TaskPanel.tsx            # 所有任务面板（最大文件）
    ThumbnailPanel.tsx       # 缩略图面板
  state/store.ts             # zustand store（单一数据源）
  lib/ipc.ts                 # Tauri invoke 封装
  i18n.ts                    # 中英文翻译 + translateError
src-tauri/src/
  render.rs                  # 渲染 + 文本提取 + 搜索
  error.rs                   # AppError 枚举（35+ 错误码）
  document.rs                # 文档打开/关闭/撤销/重做
  edit_ext.rs                # 深度编辑（M5）
  watermark_remove.rs        # 水印去除（M4）
  pages.rs                   # 页面操作
  watermark.rs               # 加水印
  lib.rs                     # 命令注册入口
```

## 标准交付流程

每个新功能按以下顺序开发：

### 1. 后端（Rust）

1. 在对应模块（`render.rs` / `edit_ext.rs` / `watermark_remove.rs` 等）写**纯函数版本**（`_logic` 后缀，参数用 bytes 而非 state），供测试复用
2. 写 Tauri command 包装函数（async + `State<'_, AppState>`），调用纯函数
3. 在 `error.rs` 新增错误码（如有），加 `code()` / `args()` / Serialize 分支
4. 在 `lib.rs` 的 `invoke_handler` 注册命令

### 2. 前端 IPC + Store

1. `src/lib/ipc.ts` 新增 invoke 封装函数，标注返回类型
2. `src/state/store.ts` 新增状态字段 + action（先 interface 声明，再初始值，再实现）
3. 如果是可撤销操作，刷新区块统一用 `refreshUndoRedo(docId)` + `setUndoRedo(...)`

### 3. 前端 UI

- 画布相关 → `Canvas.tsx` 的 `PageView` 组件
- 工具栏相关 → `Toolbar.tsx`
- 任务面板 → `TaskPanel.tsx` 对应子组件
- 样式 → `index.css`

### 4. 国际化

- `i18n.ts` 的 `en` 字典：中文 key → 英文 value
- `errZh` 字典：错误 code → 中文消息
- 组件内用 `t("中文文案")` 或 `t("文案 {name}", { name: val })`

### 5. 测试

- Rust 测试放 `src-tauri/tests/<feature>.rs`
- 调纯函数（`_logic`）而非 command，避免 Tauri 运行时依赖
- pdfium 全局单例非线程安全：已由 `src-tauri/.cargo/config.toml` 设 `RUST_TEST_THREADS=1` 自动串行化，无需手动加 `--test-threads=1`
- 每个功能至少 4 个测试：正常路径 + 边界 + 错误 + 另一种输入

### 6. 验证

```bash
# Rust 编译 + 测试
cd src-tauri && cargo check
cd src-tauri && cargo test

# Rust lint 门禁（应零告警）
cd src-tauri && cargo clippy --all-targets

# 前端类型检查
npx tsc --noEmit
```

- **提交前 `cargo clippy --all-targets` 必须零告警**（含测试目标），可自动修复的直接 `cargo clippy --fix --all-targets`

## 关键约定

### 坐标系统

| 系统 | 原点 | y 轴 |
|------|------|------|
| CSS / Canvas | 左上 | 向下 |
| PDF 点 | 左下 | 向上 |

转换公式（scale = cssW / page.width）：
- `css_left = pdf_left * scale`
- `css_top = (page_height - pdf_top) * scale`
- `pdf_left = css_left / scale`
- `pdf_top = page_height - css_top / scale`

### pdfium-render 0.8.37 常用 API

- `page.text()?` → `PdfPageText`
- `text.search(query, &PdfSearchOptions::new())` → `PdfPageTextSearch`（默认不区分大小写）
- `search.iter(PdfSearchDirection::SearchForward)` → 迭代 `PdfPageTextSegments`
- `segment.bounds()` → `PdfRect`（直接有 left/right/bottom/top）
- **注意**：`PdfRect::new(bottom, left, top, right)` — 参数顺序很坑

### 错误处理

- 所有后端错误走 `AppError`，前端用 `translateError(code, args, fallback)` 本地化
- 前端 `.catch()` 统一用 `errorToast(e)` 或静默失败
- 搜索/加载类失败后缓存空结果，避免重复请求

### 撤销/重做

- 修改文档前调用 `push_snapshot(state, doc_id)`
- 新命令后加 `canUndo` / `canRedo` / `undoDepth` / `redoDepth` 刷新
- 前端统一 `setUndoRedo(await refreshUndoRedo(id))` 一行搞定

### 画布选区模式

`selectingFor` 决定选区行为：
- `null`：无选区
- `"rewrite"`：拖拽矩形 → 文字重写
- `"addText"`：单击点 → 新增文本
- `"watermarkRemove"`：拖拽矩形 → 水印去除手动框选

`CompletedSelection.mode` 自动记录来源，接收方按 mode 过滤。

## 质量门禁

- `cargo check` 通过（warning 可接受，error 不可）
- `tsc --noEmit` 零错误
- 所有现有测试通过 + 新增测试通过
- MSIX 打包链路已就绪（`scripts/build-msix.ps1`，含 `AppxManifest.xml` 模板）；尚未上架 Microsoft Store
