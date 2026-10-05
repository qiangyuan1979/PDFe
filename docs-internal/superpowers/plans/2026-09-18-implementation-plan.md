# PDFe 实施计划

- 日期：2026-09-18
- 依据：[设计文档](../specs/2026-09-18-pdf-editor-design.md)
- 技术栈：Tauri 2 + React + TypeScript + Rust + PDFium

## 里程碑总览

| # | 里程碑 | 内容 | 验收标准 |
|---|--------|------|----------|
| M0 | 环境与骨架 | Rust 工具链、Tauri 2 项目骨架 | `npm run tauri dev` 打开空白应用窗口 |
| M1 | 文档核心管线 | PDFium 集成、打开/保存、页面渲染、撤销栈 | Rust 单测：打开样例 PDF → 渲染第 1 页位图 → 保存后可再次打开 |
| M2 | 阅读器 UI | 三栏布局、画布、缩略图、搜索、主题 | 完整阅读体验可用：滚动/缩放/跳页/搜索高亮 |
| M3 | 页面管理 + 合并拆分 | 旋转/删除/重排/提取、合并向导、拆分四模式 | 所有页面操作可撤销；合并拆分产物用外部阅读器验证 |
| M4 | 水印 | 添加（文字/图片/平铺/预览）、去除（自动+手动） | 加水印后另存文件可见；自动检测能找到测试文档水印 |
| M5 | 深度编辑 | 文字遮盖-重写、新增文本框、图片操作、扫描版提示 | 修改文字后保存，外部阅读器显示新文字且原区域无残留 |
| M6 | 安全 + 导出 | 密码保护/移除、页面导出 PNG/JPG | 加密文件需密码打开；导出图片像素正确 |
| M7 | 打磨与上架 | 统一错误处理、性能优化、E2E、MSIX 打包 | 通过 Store 认证测试 |

## 各阶段任务分解

### M0 · 环境与骨架
- [x] 安装 Rust stable-msvc 工具链（RsProxy 镜像加速）
      > 实证：`rustc 1.98.1` / host `x86_64-pc-windows-msvc`，`cargo check --all-targets` 可跑通。RsProxy 镜像属环境配置，仓库内无痕（无 `.cargo/config.toml`）。
- [x] `npm create tauri-app`：Vite + React + TypeScript 模板
- [x] 验证 `npm run tauri dev` 与 `npm run tauri build`
- [x] 接入 ESLint + Prettier + rustfmt 基础规范
      > 已接入：`eslint.config.js`（flat config，TS + React）、`.prettierrc.json`（`printWidth: 100`）/ `.prettierignore`、`rustfmt.toml`（`max_width = 100`）；`package.json` 增 `lint` / `lint:fix` / `format` / `format:check` / `format:rust` / `format:rust:check`。
      > 门禁：`npm run lint` 0 error（仅 1 条既有 `exhaustive-deps` warning）；`format:check` / `format:rust:check` 全绿。
      > 说明：`eslint-plugin-react-hooks` v7 新增的 `set-state-in-effect` / `immutability` 会命中既有写法，本次显式关闭并注释，待重构且有 UI 测试后启用。

### M1 · 文档核心管线（Rust 优先）
- [x] 集成 pdfium-render + pdfium.dll（Windows x64）
- [x] `document` 模块：open（含密码/损坏识别）/save（原子写入）/另存/元数据
- [x] `render` 模块：page→位图（缩放比感知）+ 缩略图生成，Tauri 指令返回 ArrayBuffer
- [x] 撤销快照栈（上限 20，LRU 内存预算）
      > 已实现：`document.rs` 的 `UNDO_LIMIT = 20`（条数）+ `UNDO_BUDGET_BYTES = 256 MiB`（单文档内存），统一由 `push_bounded` 从栈底淘汰最旧的快照，且至少保留 1 条；undo / redo 两侧各自独立计算预算。单测覆盖条数淘汰、预算淘汰、单条超预算三条路径。
- [x] 统一错误类型 `AppError` → 前端可读消息
- [x] 黄金文件单测（样例 PDF 入 `src-tauri/tests/fixtures/`）

### M2 · 阅读器 UI
- [x] 应用外壳：顶部工具条 + 活动栏 + 左面板（缩略图|书签）+ 右任务面板（按需展开）+ 状态栏
- [x] 跟随系统深浅主题（CSS 变量）
- [x] 画布：连续滚动/单页/双页、Ctrl+滚轮缩放、适应宽度/窗口、可视区渲染 + 相邻页预渲染
- [x] 位图 LRU 缓存（Zustand）
- [x] 缩略图虚拟滚动 + 多选（Ctrl/Shift）
- [x] 全文搜索（结果列表 + 高亮遍历 F3/Shift+F3）
- [x] 阅读位置记忆（localStorage，键为文件指纹）
      > 注：实际键为 `${fileName}:${pageCount}`，非内容指纹；同名同页数的不同文件会共用位置。

### M3 · 页面管理 + 合并拆分
- [x] 缩略图拖拽重排（插入位置指示线）+ 右键菜单
- [x] 旋转/删除/复制/插入空白页/提取
- [x] 合并向导：多文件拖入排序、页码范围、合并预览
      > 实现说明：拖入走 Tauri v2 `getCurrentWebview().onDragDropEvent()`（仅接收 .pdf，列表高亮为拖放区）；列表内用 HTML5 拖放重排（⋮⋮ 手柄 + `drop-before`/`drop-after` 插入指示线，↑↓ 按钮保留作兜底）。合并预览由新命令 `inspect_merge_sources` 提供（逐源返回 `totalPages`/`selectedPages`，单源失败只标红该项不整批失败），前端 300ms 防抖 + 序号防竞态请求，逐项显示「共 N 页 · 选用 K 页」，底部汇总「合并顺序 + 合并后共 N 页」；存在错误或合计为 0 页时禁用「开始合并」。
- [x] 拆分：每 N 页/自定义范围/按书签顶层/提取选中，多文件输出自动命名
- [x] 每项操作接入撤销栈
      > 注：页面级操作（旋转/删除/复制/插入空白）已入栈；`extract/merge/split` 产物写到新文件、不改动当前文档，故按设计不入栈。

### M4 · 水印
- [x] 添加：文字/图片、字体/字号/颜色/透明度/旋转、九宫格/平铺/拖放、范围选择
      > 拖放定位：`Canvas.tsx` 在单点（非平铺）水印上叠加 `.wm-drag-handle` 拖放手柄，指针事件用 `setPointerCapture` 捕获、拖动时经 `watermarkLayout::factorsFromBox`（`anchor_at` 的数学逆）反解出归一化因子写入 store `watermarkCustomPos`；该因子随请求以 `WatermarkStyle.custom` 下发，后端 `anchor_for` 在非平铺时优先采用（`add_text_watermark` / `add_image_watermark` 统一入口），平铺路径不经过它，与前端 `watermarkAnchors` 忽略 custom 的行为严格对齐。点击九宫格或面板卸载即清空 `custom` 回退九宫格。
- [x] 当前页实时预览（叠加层）
      > 由 `WatermarkAddPanel` 在任一参数变化时用 `src/lib/watermarkLayout.ts` 重算放置框（该模块逐行镜像后端 `watermark.rs` 的 `estimate_text_width` / `anchor` / `tile_positions`，并由 `tests/lib/watermarkLayout.test.ts` 与 Rust 单测双向锁定），写入 store `watermarkPreview`；`Canvas.tsx` 在当前页叠加 `.wm-preview-text` / `.wm-preview-image`，带字号/颜色/透明度/旋转（`transform-origin: left bottom` 对齐 PDFium 绕对象左下角顺时针旋转）与平铺多点。图片用 asset 协议（`convertFileSrc`）回显，宽高比取自 `Image.naturalWidth/Height`，与后端 `wm_h = wm_w * ih / iw` 一致。
- [x] 去除-自动：内容流分析（每页重复对象）→ 候选清单 → 勾选 → 预览 → redaction 移除
      > 跨页采样 + 指纹 + 候选清单 + 勾选（`watermark_remove::detect_watermark_candidates`）；「预览」由面板「预览删除区域」按钮把候选边界叠加到画布（store `removalPreview` + `.removal-preview-rect`）；移除按指纹在每页删除命中对象（`apply_watermark_removal`），非 PDF redaction 注释。
- [x] 去除-手动：框选区域删除
- [x] 误删保护：强制预览确认 + 撤销兜底
      > 强制预览确认：自动与手动两条路径都需先点「预览删除区域」，画布以红色叠加层标出将被删除的范围；勾选、矩形坐标、作用范围或页码任一变化即令预览失效（`previewFresh` / `manualPreviewFresh`），未预览时执行被拦截并提示。撤销兜底：`apply_watermark_removal` / `remove_objects_in_rect` 开头即 `push_snapshot`。

### M5 · 深度编辑
- [x] 扫描版检测（无文本层）→ 明确提示
- [x] 双击文字进入编辑态（虚线框 + 光标）
- [x] 保存策略：原区域遮盖 + 原字体样式重绘（字体缺失→近似替换并提示）
- [x] T 工具新增文本框；图片选中/移动/缩放/替换/删除
- [x] 画布编辑态浮动工具胶囊

### M6 · 安全 + 导出
- [x] 设置打开密码/权限密码
- [x] 移除密码（需持有密码）
- [x] 页面导出 PNG/JPG（含 DPI 选择）

### M7 · 打磨与上架
- [x] 全链路错误处理 review（中文 toast）
- [x] 大文档性能测试（500+ 页）
- [x] 命令层集成测试：打开→编辑→保存
      —— 落点由 `tauri-driver` 改为 `tauri::test` mock 运行时（`src-tauri/tests/commands.rs`）：
      tauri-driver 需 WebView2 真实驱动 + 独立 exe 启动，本机/CI 均不可靠；mock 运行时直调
      真实 `#[tauri::command]`，跑通同一 IPC 链路（含 ACL 跳过、异步命令调度、错误对象序列化），
      零外部依赖且可重复。覆盖 打开→加注释→保存→撤销/重做→关闭。
      > 过程中该测试暴露并修复了一处真实缺陷：撤销/重做把 pop 出的快照压回对面栈（应为
      > 操作前的当前 bytes），导致重做后文档状态不变（`fix(document)`，提交 `3e5a272`）。
- [x] makeappx MSIX + signtool 签名
- [x] Store listing 素材（图标/截图/描述）
      > 落点 [docs/store-listing-materials.md](../store-listing-materials.md)：300×300 一览图标 + 16:9 超级英雄图、
      > 4 对 8 张 1920×1080 截图（中英成对）、中英双份文案（简短说明/说明/产品功能）、短标题/排序标题/系统要求，
      > 均已实测达标；截图脚本 §2.3 逐张操作卡可复现。
- [x] 提交认证测试（需 Partner Center 账号）
      > 已提交认证：上传未签名包 `PDFe_0.1.0_x64.unsigned.msix`（7,191,892 B / SHA256 `D33A247C…`），
      > `runFullTrust` 用途说明已保存、隐私政策 URL 已换新地址；WACK 本地预检 24 项中 22 项 PASS（余 2 项为可选项/通性误报）。
      > ✅ **认证已通过**（2026-10-04 用户确认）：版本 `0.1.0.0` 已上架 Microsoft Store，可从商店安装（实测本机 `CCB6DC78.PDFe_0.1.0.0_x64__hmyrrnnxy08dw`）；提交后包二进制不得再改动。提交当次清单见 materials.md §5.1。

## 风险缓解（开发期）

- pdfium-render API 覆盖不足 → 原始绑定直调，必要时 FFI 补齐
- 国内网络慢 → npm 用 npmmirror、Rust 用 RsProxy、pdfium.dll 随仓库或构建期下载并校验
- 非专业开发者维护 → 每里程碑保持可运行、提交信息清晰、模块边界不漂移

## 约定

- 提交规范：`feat|fix|docs|test|chore(scope): 描述`
- 每个里程碑完成即打 tag（`v0.1.0-m1` 风格）
- 主干开发 + 里程碑标签
- 远程仓库：`origin` = https://github.com/qiangyuan1979/PDFe.git（主干 `main`；2026-09-30 由 `pdfreader001/pdfreader001` 迁移，全量历史已推送）

## 里程碑 tag 映射（补打于 2026-09-25）

补打原因：M0–M6 完成时未按约定打 tag（此前仓库 0 个 tag）。下表为按「范围收尾」定位的结果。

| tag | 指向提交 | 说明 |
|-----|----------|------|
| `v0.1.0-m0` | `c7ec8ff` | Tauri 2 + React 骨架 |
| `v0.1.0-m1` | `bb6eeeb` | PDFium 文档核心管线 |
| `v0.1.0-m2` | `d72541c` | 阅读器三栏布局与画布 |
| `v0.1.0-m3` | `928ad07` | 页面管理 + 合并拆分（含合并输出/拆分目录修正） |
| `v0.1.0-m4` | `1198655` | 水印添加（`47ac10b`）+ 去除（含自动检测） |
| `v0.1.0-m5` | `31fe8c8` | 深度编辑收尾（画布编辑态浮动工具胶囊） |
| `v0.1.0-m6` | `6a5eaad` | 安全与导出收尾（持原密码移除打开密码） |

> 注：tag 指向的提交在时间线上并非严格递增——M6 的收尾提交（`6a5eaad`）早于 M5 收尾提交（`31fe8c8`），因两个里程碑的工作交替进行。
> M7（打磨与上架）Store 认证**已通过**（版本 `0.1.0.0` 已上架，可从 Microsoft Store 安装）；`v0.1.0-m7` tag 待补打。
