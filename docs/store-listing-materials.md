# PDFe · Microsoft Store 上架素材（M7 待办项）

本文只产出**规格清单 + 截图脚本 + 商店文案草稿**，图片与最终提交都需人工完成。
实际提交动作仍卡在 Partner Center 账号（见 [实施计划](superpowers/plans/2026-09-18-implementation-plan.md) M7 未勾选项）。

## 0. 事实基线

来自 [tauri.conf.json](../src-tauri/tauri.conf.json) 与 [AppxManifest.xml](../src-tauri/msix/AppxManifest.xml)：

| 项 | 值 |
|----|----|
| 产品名 | PDFe（`productName` = `pdfe`，窗口标题 `PDFe`） |
| 版本 | `0.1.0` |
| 标识 | `com.konnyyuan.pdfe` |
| MSIX Identity | 清单为占位符 `__IDENTITY_NAME__` / `__PUBLISHER__` / `__PUBLISHER_DISPLAY_NAME__`；本地侧载默认注入 `konnyyuan.pdfe` / `CN=PDFe Local Test` / `PDFe`，上架注入 Partner Center 分配值 `CCB6DC78.PDFe` / `CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F` / `老袁不圆润`（见 §4） |
| 包系列名 PFN | `CCB6DC78.PDFe_hnyrmxy0d8w`（本地侧载测试的旧包系列为 `konnyyuan.pdfe_6cgrzvqajzfpg`，两者互不影响、可并存） |
| Store ID | `9PC0GZ78MFC41`，商店链接 `https://apps.microsoft.com/detail/9PC0GZ78MFC41` |
| 打包形态 | MSIX 包装的 full-trust Win32（`Windows.FullTrustApplication` + `rescap:runFullTrust`） |
| 最低系统 | Windows 10 1809（`10.0.17763.0`），`MaxVersionTested` = Windows 11 22H2（`10.0.22621.0`） |
| 包内语言 | `zh-CN`、`en-US` |
| 界面语言 | 中 / 英 / 日（`Ctrl+Shift+L` 循环，见 [useShortcuts.ts](../src/hooks/useShortcuts.ts#L28)） |
| 窗口 | 默认 1280×800，最小 960×640 |

两处需在提交前决策：
1. **包内语言只有 zh-CN / en-US，但界面支持日语**——若要日语一览，可在 Partner Center 作为「其他一览语言」添加（包不变），或后续把 `ja-JP` 加进清单 `Resources`。
2. **Identity 与 Publisher**：上架必须换成 Partner Center 分配值，并由微软重签；本地自签名证书只用于侧载（见 README「打包」一节）。

## 1. 图标资产

### 1.1 包内磁贴（已就绪，无需改动）

`src-tauri/icons/` 下 Windows 磁贴图标已由 Tauri 生成，实测像素如下：

| 文件 | 实测尺寸 |
|------|----------|
| `StoreLogo.png` | 50×50 |
| `Square44x44Logo.png` | 44×44 |
| `Square71x71Logo.png` | 71×71 |
| `Square89x89Logo.png` | 89×89 |
| `Square107x107Logo.png` | 107×107 |
| `Square142x142Logo.png` | 142×142 |
| `Square150x150Logo.png` | 150×150 |
| `Square284x284Logo.png` | 284×284 |
| `Square310x310Logo.png` | 310×310 |
| `Wide310x150Logo.png` | 310×150 |
| `icon.png` | 512×512（多用途源图） |

### 1.2 Store 一览所需

| 资产 | 规格 | 状态 |
|------|------|------|
| 1:1 应用磁贴图标 | PNG，**300×300** | **已产出**——`docs/store-listing/StoreLogo-300x300.png`（实测 300×300，14.5 KB，由 `icon.png` 512×512 双三次缩放） |
| 16:9 超级英雄图 | PNG，1920×1080（或 3840×2160） | **已产出**——`docs/store-listing/Hero-1920x1080.png`（实测 1920×1080，898 KB）与 `Hero-3840x2160.png`（实测 3840×2160，2.1 MB）。由 System.Drawing 程序生成的抽象渐变图：深海军蓝→品牌蓝斜向底色 + 柔和径向光晕 + 流光带 + 细颗粒 + 暗角；**无文字、无应用 UI、非图库照片**，色相全部落在 `#0067c0`/`#4cc2ff` 同色系 |

注意：**不要**把包内 50×50 的 `StoreLogo.png` 当一览图上传，会明显模糊。

生成 300×300 的一行命令（PowerShell，需 System.Drawing）：

```powershell
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile("src-tauri\icons\icon.png")
$dst = New-Object System.Drawing.Bitmap 300,300
$g = [System.Drawing.Graphics]::FromImage($dst)
$g.InterpolationMode = "HighQualityBicubic"
$g.DrawImage($src, 0, 0, 300, 300)
$g.Dispose(); $dst.Save("docs\store-listing\StoreLogo-300x300.png", [System.Drawing.Imaging.ImageFormat]::Png)
$dst.Dispose(); $src.Dispose()
```

## 2. 截图脚本

### 2.1 硬性规格（来自 Microsoft Learn）

- PNG（横向或纵向），单文件 ≤ 50 MB
- 桌面设备族：**1366×768 或更大**，支持 4K（3840×2160）
- 桌面截图最多 10 张，**至少 1 张必填**；官方建议 5–8 张、每个设备族至少 4 张
- 每张可配 ≤ **200 字符**说明文字，按上传顺序展示
- 构图：关键视觉与文字放在**上 2/3**（底部可能被文字覆盖层遮挡）；不要自行叠加 logo／图标／营销文案；避免极亮极暗或高对比条纹

### 2.2 拍摄前准备

1. **不需要改显示缩放**：截屏抓的是物理像素，与缩放无关。本机实测屏幕模式 2560×1440 @60Hz、缩放 150%，`Win+PrtScn` / `CopyFromScreen` 截出的就是 2560×1440，天然 ≥1366×768。只需**逐张核对像素尺寸**（右键属性 → 详细信息）确认达标。
2. 应用窗口**最大化**——默认窗口 1280×800 宽度不足 1366，直接截会不达标。
3. 准备三类真实文档（不要用 `tests/` 里合成的 `large_100.pdf` / `large_500.pdf`，画面无代表性）：
   - 多页图文 PDF，≥10 页、带目录书签（用于阅读/搜索/批注/页面管理）
   - 带重复水印的 PDF（用于水印去除）
   - 带 AcroForm 字段的 PDF（用于表单）

   三类样例已生成，位于 [`docs/store-listing/samples/`](samples/)（已入库，随仓库长期保留）：

   | 文件 | 对应操作卡 | 已验证特征 |
   | --- | --- | --- |
   | `01-article.pdf`（12 页，约 504 KB） | 01 阅读主界面 / 02 全文搜索与高亮 / 03 批注 / 04 页面管理 | 12 页图文正文 + 10 条中文目录书签（亦可用于补位 11 诊断面板） |
   | `02-watermark.pdf`（约 389 KB） | 05 水印添加与去除 | 每页 6 个 −30° 旋转的**文本**水印，跨页指纹经 `quantize(·,5)` 后完全一致；预期检测出 6 个候选、ratio = 1.00 |
   | `03-form.pdf`（1 页，约 136 KB） | 10 表单字段填写（补位） | 真实 pdfium 识别出 7 个字段：`ApplicantName` / `EmployeeId` / `Email` / `StartDate` → `T`，`Department` → `▼T`，`AgreeTerms`（已勾选）/ `EnableBackup`（未勾选）→ `☑` |

   ⚠️ `03-form.pdf` 的语言差异：正文（标题、标签、表格）为中文，但 **AcroForm 字段名与填写值是 ASCII**（`/AP` 外观流使用标准 Helvetica，无法承载中文），截图时表单面板的字段名列会显示英文。其余两份文档内容全中文。
4. 截图方式：按 `Win + PrtScn`（整屏 → `图片\屏幕截图`），或 `Win+Shift+S` 矩形截图后另存。
5. 命名：`01-reader-zh.png`、`01-reader-en.png` …（中英各一套，Store 一览按语言分别上传图片）。

> 依赖说明：应用无 CLI 参数、无文件关联；打开文档只能走 `@tauri-apps/plugin-dialog` 的原生对话框（**合并向导**面板可接收系统拖入的 `.pdf`，但该入口只用于合并、不用于打开文档），因此「有内容」的截图**必须人工操作**（自动化需 SendKeys 驱动原生对话框，会抢焦点且可能把路径键入其他程序）。

### 2.3 逐张操作卡（主卡 9 张 + 可选补位；Store 桌面最多 10 张）

界面元素取自 [Toolbar.tsx](../src/components/Toolbar.tsx)、[Rail.tsx](../src/components/Rail.tsx)、[StatusBar.tsx](../src/components/StatusBar.tsx)、[ThumbnailPanel.tsx](../src/components/ThumbnailPanel.tsx) 及各 `panels/*Panel.tsx`。**按钮名一律照抄界面中文文案**（界面默认中文；英文界面下的对应文案见各卡「说明（EN）」）。

#### 通用流程（每张都先做）

1. **启动**：开始菜单搜 `PDFe`，或 PowerShell（已装 MSIX）：

   ```powershell
   $pkg = Get-AppxPackage konnyyuan.pdfe
   Start-Process ("shell:AppsFolder\{0}!App" -f $pkg.PackageFamilyName)
   ```

2. **最大化窗口**：标题栏双击或点最大化（默认 1280×800 宽度不足 1366，不最大化会不达标）。
3. **打开文档**：点工具栏 `📂 打开`（或 `Ctrl+O`）→ 原生对话框选文件。
4. **截图**：`Win + PrtScn`（整屏 → `图片\屏幕截图`）或 `Win+Shift+S` 框选后另存。
5. **核对尺寸**：文件右键 → 属性 → 详细信息，确认 ≥1366×768（本机实测 2560×1379）。
6. **命名与存放**：`docs/store-listing/screenshots/{nn}-{scene}-{lang}.png`（如 `01-reader-zh.png`）；中英各一套，英文界面点工具栏 `EN`（或 `Ctrl+Shift+L` 循环语言）。
7. **主题**：左栏底部 `☀`/`🌙` 切换；建议 7 张浅色、1 张深色。

---

#### 01 阅读主界面 — `01-reader-zh.png`

- **前置**：多页图文 PDF（≥10 页、带书签）
- **步骤**：
  1. 打开文档（`📂 打开`）
  2. 工具栏视图切换点 `连续`
  3. 左栏点 `▦ 页面缩略图` 展开缩略图
  4. 滚到一页图文并茂的正文（状态栏「第 x / N」正常刷新）
- **入镜**：工具栏（`PDFe` + `📂 打开` / `↶ 撤销` / `↷ 重做` + 9 工具 `🗂 合并`/`✂ 拆分`/`💧 水印`/`✏ 编辑`/`🔒 密码`/`🖼 导出`/`🩺 诊断`/`🔍 OCR`/`📝 表单` + `连续/单页/双页` + `🔍 搜索` + `中/EN` + `?`）、左栏缩略图、正文、底部状态栏（`文件名 · 共 N 页`、`第 x / N`、`− 适应宽度 ＋ ⤢`）
- **自检**：状态栏显示文件名与总页数；缩略图栏可见；关键内容在上 2/3
- **说明（中）**：打开即读：连续滚动、缩略图导航、深色/浅色主题
- **说明（EN）**：Open and read: continuous scrolling, thumbnail navigation, light/dark themes

#### 02 全文搜索与高亮 — `02-search-zh.png`

- **前置**：同一份图文 PDF
- **步骤**：
  1. `Ctrl+F`（或点 `🔍 搜索`）打开搜索面板
  2. 输入一个文中多次出现的词，回车
  3. 面板顶部变为 `{x} / {y} 个结果`，列表逐行显示 `第 {n} 页` + 命中片段（命中词用 `<mark>` 高亮）
  4. 按 `↓`（或 `F3`）跳到下一个命中，页面上出现高亮块
- **入镜**：搜索面板（结果计数 + 命中列表 + `↑`/`↓`/`✕`）、页面上的高亮块
- **自检**：面板顶部**不是**「输入关键词后回车」；页面高亮块可见
- **说明（中）**：全文搜索，命中结果在页面直接高亮并逐条跳转
- **说明（EN）**：Full-text search with on-page highlighting and jump-to-hit

#### 03 批注 — `03-annot-zh.png`

- **前置**：同一份图文 PDF
- **步骤**：
  1. 点工具栏 `✏ 编辑` 打开右侧面板（默认停在 `注释` 页签，无需切换）
  2. 选一种批注类型：`🖍 高亮` / `U̲ 下划线` / `S̶ 删除线` / `📝 便签` / `T 文字框` / `▭ 矩形`
  3. （可选）在「文本」里填内容 → 点 `添加到当前页`
  4. 批注出现在页面**左上固定条带**；若要多条，**每种换一页**再添加
- **入镜**：右侧「编辑 · 注释」面板（类型选择 + 文本 + `添加到当前页`）、下方「本页注释（n）」列表（色块 + 类型 + 文本）、页面上的批注标记
- **自检**：列表中**3 条**；高亮 / 下划线 / 删除线三种标记在同一页画布**上部同时可见**
- **注意**：批注落点是**硬编码固定区域**（`left 15% / top 20% / 宽 70% / 高 7%`，见 [EditPanel.tsx](../src/components/panels/EditPanel.tsx#L113-L118)），**不支持画布框选**；同页叠加多种类型会互相重叠——按 UI 流程拍摄时每页只加 1 种。
- **已产图说明**：`03-annot-zh.png` / `03-annot-en.png` 中三条批注按**正文命中位置**落点（走 IPC 直调生成，非面板固定区域流程），因此三者互不重叠、分别贴合「数据来源 / 客流总量 / 换乘」三处正文；面板的固定区域流程**无法复现**该定位。若严格按 UI 复现，请每页只加 1 种类型。
- **说明（中）**：6 种批注：高亮、下划线、删除线、便签、自由文本、矩形
- **说明（EN）**：Six annotation types: highlight, underline, strikeout, sticky note, free text, rectangle

#### 04 页面管理 — `04-pages-zh.png`

- **前置**：≥10 页 PDF
- **步骤**：
  1. 左栏点 `▦ 页面缩略图`
  2. 按住 `Ctrl`/`Shift` 点击缩略图**多选** 2–3 页（出现选中态）
  3. 在选中的缩略图上**右键**，弹出菜单：`↺ 逆时针旋转 90°`、`↻ 顺时针旋转 90°`、`⟲ 旋转 180°`、`📋 复制页面`、`➕ 插入空白页`、`🗑 删除页面`、`📤 提取为新文档`
  4. **让右键菜单保持展开**再截图（菜单本身是本张的画面重点）
- **入镜**：缩略图多选态 + 展开的右键菜单
- **自检**：菜单可见；多选 ≥2 页
- **说明（中）**：缩略图管理页面：多选、拖拽重排、旋转与删除
- **说明（EN）**：Manage pages from thumbnails: multi-select, drag to reorder, rotate and delete

#### 05 水印添加与去除 — `05-watermark-zh.png`

- **前置**：带**重复**水印的 PDF
- **步骤（添加水印，面板默认页签）**：
  1. 点工具栏 `💧 水印` 打开面板（默认停在 `添加水印`）
  2. 顶部选 `文字水印`（或 `图片水印`），填 `水印文字`，调 `字号` / `颜色` / `透明度` / `旋转角度`
  3. `位置`：或点上排九宫格 `◤ ▲ ◥ ◀ ◉ ▶ ◣ ▼ ◢`，或**直接在画布上拖动水印本体**定位（拖动后 `位置` 下方出现提示 `已用画布拖动定位；点击上方九宫格可重置。`）
  4. 勾 `平铺整页` 可见 `间距`（pt）输入；如已多选页面可勾 `仅应用到选中的 {n} 页`
  5. **实时预览**：以上任一参数变化，画布当前页立即按该参数叠加显示水印效果（无需先点添加）
  6. 点 `添加水印`（执行中显示 `添加中…`）
- **步骤（去除水印 · 自动检测）**：
  1. 顶层切到 `去除水印`，子模式选 `自动检测`
  2. `采样页数` 保持默认 → 点 `开始检测`（执行中显示 `检测中…`）
  3. 候选列表出现 `类型: kind · 位置: (l,b)–(r,t) · 出现: n/total`
  4. 勾选候选 → 点 `预览删除区域` → 核对画布上的红框 → 点 `确认去除（已选 {n} 项）`
- **步骤（去除水印 · 手动框选，备选）**：切 `手动框选` → 点 `🎯 在画布上框选水印区域` → 画布上拖框 → 核对 `左 / 下 / 右 / 上` 坐标 → `预览删除区域` → `确认去除`
- **入镜**：水印面板「添加水印 · `文字水印`」（`水印文字` / `字号` / `颜色` / `透明度` / `旋转角度` + `位置` 九宫格 + `添加水印`）+ 画布上按当前参数**实时预览**的水印本体
- **自检**：`位置` 九宫格与画布实时预览水印**同时可见**（无需先点 `添加水印`）；九宫格中心 `◉` 处于选中态
- **注意**：本样例的正文水印逐页版式不同，`去除水印 · 自动检测` 会检出大量候选（实测 **39 个候选 / 画布 74 个红框**），画面观感差；故 05 张固定采用「添加水印 · 实时预览」变体，**不要**改用自动检测构图。
- **说明（中）**：添加文字/图片水印并在画布上拖动定位，或自动检测重复水印对象后一键去除
- **说明（EN）**：Add text or image watermarks and place them by dragging on the canvas, or auto-detect repeating watermark objects and remove them

#### 06 深度编辑 — `06-rewrite-zh.png`

- **前置**：正文为**可选文字**的 PDF（非扫描件）
- **步骤**：
  1. 点工具栏 `✏ 编辑` → 面板切到 `深度编辑` 页签
  2. 画布底部浮动胶囊点 `编辑`（会自动切到深度编辑页签；点 `选择` 模式下双击无反应）
  3. 二选一取词：
     - **双击**正文某处文字，或
     - 在画布上**拖拽框选**一段文字
  4. 弹出 `RewriteModal`：顶部「已选区 · 第 n 页」+ 矩形 pt 尺寸，含`原文`、`原字体`、新文本、字号、颜色
  5. 改新文本 → 点 `确认重写`（原字体不可用时另弹 toast「原字体不可用，已用近似字体替换」）
- **入镜**：画布虚线编辑框、底部胶囊（`选择`/`编辑`/`文字`）、`RewriteModal`（原文 / 原字体 / 新文本 / `确认重写`）
- **自检**：弹窗出现「原文」「原字体」字段
- **说明（中）**：原位重写正文：保留原字号与颜色，字体缺失自动近似替换
- **说明（EN）**：Rewrite text in place keeping the original style; missing fonts are substituted automatically

#### 07 密码与权限 — `07-security-zh.png`

- **前置**：一个**加密**（带打开密码）的 PDF；无加密样本时可用普通 PDF 但说服力弱
- **步骤**：
  1. 点工具栏 `🔒 密码` 打开面板
  2. 顶部徽章应显示 `已加密（{handler}）`（未加密文档显示 `未加密`）
  3. 「现有打开密码」输入密码 → 点 `读取加密状态`
  4. 下方 8 行权限矩阵：`高质量打印`/`低质量打印`/`修改文档内容`/`抽取文本与图形`/`添加或修改注释`/`填写表单字段`/`组装文档（插页/旋转/删页等）`/`创建新表单字段`，每行 `允许` 或 `禁止` + 圆点
  5. 底部三个按钮：`导出明文副本` / `在内存中去除加密` / `导出加密副本`
- **入镜**：状态徽章 + 权限矩阵 + 底部按钮
- **自检**：徽章是「已加密…」而非「未加密」；矩阵为 8 行
- **说明（中）**：查看加密状态与权限矩阵，导出明文副本或内存去加密
- **说明（EN）**：Inspect encryption status and permissions, export a plain copy or strip encryption

#### 08 导出图片 — `08-export-zh.png`

- **前置**：任意 PDF
- **步骤**：
  1. 点工具栏 `🖼 导出` 打开面板
  2. 模式选 `PDF → 图片`
  3. 「页码范围」填 `1,3,5-7`（留空 = 当前页）
  4. 格式选 `PNG（无损）` 或 `JPEG（体积小）`
  5. DPI 设 150（范围 36–600）
  6. 点 `导出图片` → 原生「选择文件夹」对话框 → 导出完成后弹 toast
- **入镜**：导出面板（4 个模式 `PDF → 图片` / `图片 → PDF` / `Office → PDF` / `电子书 → PDF`、页码范围、格式、DPI、`导出图片` 按钮）
- **自检**：`PDF → 图片` 处于选中态；DPI 数值可见
- **说明（中）**：页面导出 PNG/JPG，可选 DPI；图片也能反向合并成 PDF
- **说明（EN）**：Export pages to PNG/JPG at a chosen DPI; images can be merged back into PDF

#### 09 合并向导 — `09-merge-zh.png`

- **前置**：≥2 份 PDF（各份页数不同，总数不宜过多，便于一行行看清）
- **步骤**：
  1. 点工具栏 `🗂 合并` 打开面板
  2. 点 `➕ 添加文件` 选 3 份 PDF；或**把 `.pdf` 从资源管理器拖入窗口**（拖动进窗口时合并列表区高亮，松开即加入；非 `.pdf` 会被忽略）
  3. 用每行左侧 `⋮⋮` 手柄**拖动调整顺序**（拖动时列表出现插入指示线）；也可用行内 `↑` / `↓` / `✕`
  4. 每行核对 `共 {n} 页 · 选用 {k} 页`；在输入框填页码范围（如 `1,3,5-7`，留空为全部页）
  5. 底部核对汇总 `合并顺序：1 → 2 → 3` 与 `合并后共 {n} 页`
  6. （可选）点 `选择…` 指定输出文件；留空则显示 `未选择（结果仅打开到查看器）`
  7. 点 `开始合并`（执行中显示 `合并中…`）
- **入镜**：合并面板列表（`⋮⋮` 手柄 + 序号 + 文件名 + `↑` / `↓` / `✕` + `共 N 页 · 选用 K 页`）、页码范围输入框、汇总行（`合并顺序：…` / `合并后共 N 页`）、底部 `开始合并`
- **自检**：每行都显示页数而非 `读取中…`；汇总「合并后共 N 页」与各行之和相符；无标红行（有则会出现 `请先修正标红的页码范围，或删除该文件`）
- **说明（中）**：合并向导：拖入多个 PDF、拖拽排序、逐份指定页码范围并预览合并后总页数
- **说明（EN）**：Merge wizard: drop multiple PDFs, drag to reorder, set page ranges per file and preview the merged page count

---

**可选补位（替换/追加，Store 桌面最多 10 张）**：

推荐优先补 **`10 表单字段填写`**——与主卡 01–09 合计正好 10 张，用满上限。

| # | 场景 | 操作要点 |
|---|------|----------|
| 10 | 表单字段填写 — `10-form-zh.png` | 点工具栏 `📝 表单` → 面板列出 AcroForm 字段（`text` 显示为 `T`、`checkbox` 显示为 `☑`，其余只读）→ 改一个文本字段值 → 保持画面（可点 `保存表单`）。无字段时提示「当前文档没有表单字段」。 |
| 11 | 诊断面板 / 英文界面 — `11-diag-en.png` | 点工具栏 `🩺 诊断` 展示页数/大小/加密/扫描抽样/注释总数；再切英文界面（工具栏 `EN` 或 `Ctrl+Shift+L`）重拍整套。 |

**OCR 面板不建议入镜**：`ocr` 为可选 feature，默认构建下调用返回 `ocr_unavailable`。要拍该场景必须先 `cargo build --features ocr`（需 Tesseract + 语言包）。

### 2.4 拍摄速查表（一页版）

> 一页看完 9 张主卡 + 2 张补位。**每张都先做**：启动 → 窗口最大化 → 打开文档 → 截图 → 核对 ≥1366×768 → 命名到 `docs/store-listing/screenshots/{nn}-{scene}-{lang}.png`。详细步骤回看 §2.3 对应卡。

| # | 场景 | 用哪份样例 | 关键前置与步骤（一句话） | 自检要点 | 文件名（zh / en） |
|---|------|-----------|--------------------------|----------|-------------------|
| 01 | 阅读主界面 | `01-article.pdf` | 打开 → 视图切 `连续` → 左栏 `▦ 页面缩略图` → 滚到图文页 | 状态栏有文件名+总页数、缩略图可见、关键内容在上 2/3 | `01-reader-zh.png` / `01-reader-en.png` |
| 02 | 全文搜索与高亮 | `01-article.pdf` | `Ctrl+F` → 输入多次出现的词回车 → `↓`／`F3` 跳到下一处 | 面板顶部为 `{x} / {y} 个结果`（**不是**「输入关键词后回车」）、页面高亮块可见 | `02-search-zh.png` / `02-search-en.png` |
| 03 | 批注 | `01-article.pdf` | `✏ 编辑`（默认 `注释` 页签）→ 选类型 → 填文本 → `添加到当前页`；**每页只加 1 种** | 列表 **3 条**、高亮/下划线/删除线在画布上部**同时可见** | `03-annot-zh.png` / `03-annot-en.png` |
| 04 | 页面管理 | `01-article.pdf` | 左栏 `▦ 页面缩略图` → `Ctrl`/`Shift` 多选 2–3 页 → 缩略图**右键** → **让菜单保持展开**再截 | 右键菜单可见、多选 ≥2 页 | `04-pages-zh.png` / `04-pages-en.png` |
| 05 | 水印添加与去除 | `02-watermark.pdf` | 添加：`💧 水印` → `文字水印` → 调参 → **不必点添加**，画布已实时预览 | 同时见 `位置` 九宫格（中心选中）+ 画布实时预览水印本体 | `05-watermark-zh.png` / `05-watermark-en.png` |
| 06 | 深度编辑 | `01-article.pdf` | `✏ 编辑` → `深度编辑` 页签 → 底部胶囊点 `编辑` → **双击**或**框选**正文文字 → 弹 `RewriteModal` | 弹窗含「原文」「原字体」字段 | `06-rewrite-zh.png` / `06-rewrite-en.png` |
| 07 | 密码与权限 | 07 卡加密样本（**自造**，见下注 1） | `🔒 密码` → 「现有打开密码」填密码 → `读取加密状态` | 徽章为 `已加密（…）` 而**非** `未加密`；权限矩阵 8 行 | `07-security-zh.png` / `07-security-en.png` |
| 08 | 导出图片 | 任意（建议 `01-article.pdf`） | `🖼 导出` → 模式 `PDF → 图片` → 页码 `1,3,5-7` → 格式 + DPI 150 → `导出图片` | `PDF → 图片` 处于选中态、DPI 数值可见 | `08-export-zh.png` / `08-export-en.png` |
| 09 | 合并向导 | ≥2 份 PDF（建议 `01`+`02`+`03`） | `🗂 合并` → `➕ 添加文件` 或拖入 3 份 → `⋮⋮` 排序 → 核对每行页数与汇总 | 各行显示页数而非 `读取中…`、汇总「合并后共 N 页」相符、无标红行 | `09-merge-zh.png` / `09-merge-en.png` |
| 10 | 表单字段填写（补位） | `03-form.pdf` | `📝 表单` → 列字段 → 改一个文本字段值 → 保持画面（可点 `保存表单`） | 字段列表 **7 行**，可见 `T` / `▼T` / `☑` | `10-form-zh.png` / `10-form-en.png` |
| 11 | 诊断面板 / 英文界面（补位） | `01-article.pdf` | `🩺 诊断` 展示摘要；或切 `EN` 重拍整套 | 面板显示页数/大小/加密/扫描抽样/注释总数 | `11-diag-en.png` |

**实操提示（2026-09-26 查源码确认）**

1. **07 卡的加密样本可用应用自身造**（无需外部工具）：打开 `01-article.pdf` → `🔒 密码` 面板 → 「打开密码」填任意值（「权限密码」留空则与打开密码相同）→ 点 `导出加密副本`（默认名 `encrypted.pdf`）→ 用该文件重新打开，徽章即显示 `已加密（…）`。依据 [SecurityPanel.tsx](../src/components/panels/SecurityPanel.tsx#L175) 与第 284–286 行；两个密码都为空时按钮禁用。
2. **05 卡不要用「自动检测」构图**：`采样页数` 默认 10（[WatermarkPanel.tsx](../src/components/panels/WatermarkPanel.tsx#L446-L447)），本样例仅 6 页会被**全量采样**；但正文水印逐页版式不同，实测检出 **39 个候选**、画布画出 **74 个红框**，画面观感差（§2.3 主卡里「出现如 `8/12`」只是泛例）。自动检测仅用于功能验证，05 张统一采用「添加水印 · 实时预览」变体。输入框范围 2–50。
3. **省事拍摄顺序**（每份文档只开一次，拍完切 `EN` 整体重拍一遍）：
   - `01-article.pdf` → 01、02、03、04、07、08、11
   - `02-watermark.pdf` → 05
   - `03-form.pdf` → 10
   - 09 用 `01`+`02`+`03` 三份凑数（页数各不相同，汇总行更好看）
4. **03（批注）与 04（页面管理）都在同一份文档上操作**，建议先拍 04（只多选 + 右键，不改文档），再拍 03（会写入批注，改动文档状态）。

## 3. 商店文案

字段限制（来自 Partner Center 一览文档）：说明必填 ≤10,000 字符；简短说明上限 1000、最佳 <270；产品功能最多 20 条、每条 ≤200 字符；短标题 ≤50；排序标题／语音标题 ≤255；「此版本中的新增功能」≤1500（**首次提交留空**）。

**实测字符数（按 Unicode 码点计，含段内换行、不含末尾换行）**：简短说明 中 75 / EN 236（均 <270）；说明 中 778 / EN 2035（≤10,000）；产品功能 中 10 条最长 55、EN 10 条最长 155（各 10 条，共 20 条 ≤20，每条 ≤200）；短标题 4 / 排序标题 22 / 语音标题 4（≤255）。**全部达标**。

### 3.1 简短说明

**中**（实测 75 字符）：

> 轻量、离线的 Windows PDF 阅读与编辑工具：阅读、批注、搜索、页面管理、水印增删、表单填写、密码保护与图片导出，全部在本机完成，文件不上传。

**EN**（实测 236 字符，<270 上限，留余量）：

> A lightweight, offline PDF reader and editor for Windows. Read, annotate, search, manage pages, add or remove watermarks, fill forms, protect with passwords, and export to images — all processed locally on your PC, with no file uploads.

### 3.2 说明（必填）

**中**：

```text
PDFe 是一款面向 Windows 的轻量 PDF 阅读与编辑工具，基于 PDFium 渲染，启动快、内存占用低，所有处理都在本机完成——文档不会上传到任何服务器。

阅读
· 连续滚动、单页、双页对开三种视图，缩放 10%–800%，支持适应宽度/页面
· 左侧缩略图导航与书签大纲，底部状态栏显示页码与文件名
· 深色 / 浅色主题，中 / 英 / 日三语界面

查找与批注
· 全文搜索，命中结果在页面上高亮并逐条跳转
· 6 种批注：高亮、下划线、删除线、便签、自由文本、矩形

页面与文档
· 合并向导：把多个 PDF 直接拖入面板、拖拽调整顺序，逐份指定页码范围并实时预览合并后总页数
· 旋转、删除、重排、提取页面；按页数、自定义范围或书签层级拆分
· 文本重写：在编辑模式下双击正文即原位改写，遮盖原区域后按原样式重绘（字体缺失自动近似替换并提示）
· 图片选中、移动、缩放、替换、删除

水印
· 添加文字/图片水印，可在画布上直接拖动定位；按重复对象自动检测并去除，或手动框选区域去除

安全与导出
· 设置打开密码与权限密码，查看权限矩阵；持有密码时移除加密，或导出明文副本
· 导出页面为 PNG / JPG，可选 DPI；图片可反向合并为 PDF
· 表单（AcroForm）字段列出并填写后写回文档
· 文档诊断：页数、大小、是否加密、扫描版抽样、批注总数

快捷键
Ctrl+O 打开 · Ctrl+S 保存 · Ctrl+F 搜索 · Ctrl+Z/Ctrl+Y 撤销重做
Ctrl+1/2/3 视图切换 · Ctrl+Shift+L 语言 · Ctrl+Shift+T 主题 · F1 帮助

适用场景：日常阅读、合同/报告批注、扫描件整理、批量页面处理。

系统要求：Windows 10 1809 及以上（x64）。
```

**EN**：

```text
PDFe is a lightweight PDF reader and editor for Windows, built on PDFium for fast startup and low memory use. Everything runs locally on your PC — your documents are never uploaded.

READ
· Continuous, single-page and two-page views; zoom from 10% to 800%, fit-to-width and fit-to-page
· Thumbnail navigation and bookmark outline on the left; page number and file name in the status bar
· Dark and light themes; Chinese, English and Japanese interface

FIND & ANNOTATE
· Full-text search with on-page highlights and jump-to-hit
· Six annotation types: highlight, underline, strikeout, sticky note, free text, rectangle

PAGES & DOCUMENTS
· Merge wizard: drop multiple PDFs into the panel, drag to reorder, set page ranges per file and preview the merged page count in real time
· Rotate, delete, reorder and extract pages; split by page count, custom ranges or bookmark levels
· Text rewrite: in edit mode, double-click text to rewrite it in place, covering the original area and redrawing with the original style (falls back to a near match when a font is missing)
· Select, move, resize, replace and delete images

WATERMARKS
· Add text or image watermarks and position them by dragging on the canvas; auto-detect repeating watermark objects and remove them, or drag-select a region to remove

SECURITY & EXPORT
· Set open and permission passwords and review the permission matrix; remove encryption when you know the password, or export a plain copy
· Export pages to PNG / JPG at a chosen DPI; images can be merged back into PDF
· List and fill AcroForm fields, written back to the document on save
· Document diagnostics: page count, file size, encryption, scanned-page sampling, annotation total

SHORTCUTS
Ctrl+O open · Ctrl+S save · Ctrl+F search · Ctrl+Z / Ctrl+Y undo and redo
Ctrl+1/2/3 view modes · Ctrl+Shift+L language · Ctrl+Shift+T theme · F1 help

Good for everyday reading, marking up contracts and reports, cleaning up scanned files, and batch page work.

System requirements: Windows 10 version 1809 or later (x64).
```

### 3.3 产品功能（每条 ≤200 字符，不要自带项目符号）

**中（10 条）**

1. 连续 / 单页 / 双页三种阅读视图，10%–800% 缩放
2. 全文搜索，命中结果页面高亮并逐条跳转
3. 6 种批注：高亮、下划线、删除线、便签、自由文本、矩形
4. 合并向导：拖入多个 PDF、拖拽排序并预览合并后页数；页面旋转 / 删除 / 重排 / 提取，按页数或书签拆分
5. 编辑模式下双击正文即原位改写文字，按原字体样式重绘
6. 水印添加并可在画布上拖动定位；自动检测重复水印对象或手动框选去除
7. 打开密码与权限密码，权限矩阵查看，导出明文副本
8. 页面导出 PNG / JPG 并可指定 DPI，图片反向合并为 PDF
9. 表单（AcroForm）字段填写并写回文档
10. 全离线处理，文档不上传；中 / 英 / 日三语，深色与浅色主题

**EN（10 条）**

1. Continuous, single-page and two-page reading views with 10%–800% zoom
2. Full-text search with on-page highlights and jump-to-hit
3. Six annotation types: highlight, underline, strikeout, sticky note, free text, rectangle
4. Merge wizard: drop multiple PDFs, drag to reorder and preview the merged page count; rotate, delete, reorder and extract pages; split by pages or bookmarks
5. In edit mode, double-click to rewrite text in place with the original font style
6. Add watermarks and position them by dragging on the canvas; remove them by auto-detecting repeating objects or drag-selecting a region
7. Open and permission passwords, permission matrix, plain-copy export
8. Export pages to PNG / JPG at a chosen DPI; merge images back into PDF
9. Fill AcroForm fields and write them back to the document
10. Fully offline — no uploads; Chinese, English and Japanese UI; dark and light themes

### 3.4 补充字段

| 字段 | 上限 | 拟填值 |
|------|------|--------|
| 短标题 | 50 | `PDFe` |
| 排序标题 | 255 | `PDFe PDF reader editor` |
| 语音标题 | 255 | `PDFe` |
| 此版本中的新增功能 | 1500 | 首次提交**留空** |
| 其他系统要求 · 最低硬件 | ≤11 条 | `Windows 10 1809 或更高（x64）` / `64 位处理器` |
| 其他系统要求 · 推荐硬件 | ≤11 条 | `Windows 11` / `4 GB 内存或更多` |

## 4. Partner Center 侧待决策项（本文不代替决策）

- **类别**：建议「效率 / Productivity」，需在提交时确认可用类目
- **定价与市场**：免费 + 全市场（需确认是否只投 zh-CN / en-US 市场）
- **年龄分级**：按 Partner Center 问卷填写
- **隐私政策 URL**：本应用无网络通信、不上传文件；政策已托管并**验证可访问**（HTTP 200，中英双版渲染正常）：

  ```
  https://qiangyuan1979.github.io/PDFe/store-listing/privacy-policy.html
  ```

  源文件三形态见 [`store-listing/privacy-policy.md`](store-listing/privacy-policy.md) / [`.html`](store-listing/privacy-policy.html) / [`.txt`](store-listing/privacy-policy.txt)；托管方式为 GitHub Pages（Settings → Pages → Source「Deploy from a branch」+ `main` + `/docs`）。提交必须填**以 `.html` 结尾**的地址，不能填 `.md`。联系方式由仓库 Issues 页承载。⚠️ 路线 A 会把整个 `docs/` 目录作为网站公开，故该目录内**不得**出现内部备注/密钥类内容。
- **产品类型**：必须选 **MSIX/PWA**，不要选「独立 .exe/.msi 安装程序包」。后者要求提交**版本化 HTTPS 直链**（需自建托管并自行维护更新链接）、**自备链接到 Microsoft Trusted Root Program 的 CA 代码签名证书**（Store 不重签）、提交**静默离线安装器**（不可为下载器 stub），且提交后二进制不得更改。MSIX 路径由**微软免费重签 + 免费 CDN 托管 + 自动更新**，与现有打包链路直接对接。
- **身份替换**：三个值取自 Partner Center「产品管理 → 产品标识」——`包/标识/名称`（Identity `Name`）、`包/标识/发布者`（Identity `Publisher`，微软重签由平台处理，无需与本地证书一致）、`包/属性/发布者显示名称`（`PublisherDisplayName`）。打包脚本已参数化（`-IdentityName` / `-Publisher` / `-PublisherDisplayName`），详见 [README](../README.md) 的 MSIX 小节。
  **2026-09-26 已取得实际值并出包**：
  - 包/标识/名称 = `CCB6DC78.PDFe`
  - 包/标识/发布者 = `CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F`（形如 Guid 的 CN，非域名式）
  - 包/属性/发布者显示名称 = `老袁不圆润`
  - 包系列名（PFN）= `CCB6DC78.PDFe_hnyrmxy0d8w`；Store ID = `9PC0GZ78MFC41`；商店链接 `https://apps.microsoft.com/detail/9PC0GZ78MFC41`
  - 出包命令：`scripts\build-msix.ps1 -Sign None -IdentityName CCB6DC78.PDFe -Publisher "CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F" -PublisherDisplayName "<发布者显示名称>"`。⚠️ 中文显示名建议写成 UTF-8 文件后用 `[System.IO.File]::ReadAllText(..., UTF8)` 读入再传参，直接写在命令行可能被 PowerShell 5.1 按 GBK 解码成乱码（乱码会原样进清单，Partner Center 校验会再次报 `PublisherDisplayName` 不匹配）。
- **受限功能 `runFullTrust`**：Medium IL 桌面应用按微软文档**必须**声明该能力，无法移除。Partner Center「提交选项 / Submission options」页需填写用途说明并**点保存**，否则该节保持 Incomplete。
  ⚠️ 该输入框上限 **300 字符（中英合计，含换行）**，故必须用短版；上面那版「加长版」已超限、会被截断，勿再使用。拟填短版（中文 53 + 换行 1 + 英文 237 = **291 字符**，留 9 字符余量）：
  > PDFe 是离线运行的桌面 PDF 阅读与编辑工具，基于本机 PDFium 引擎，不联网、不收集用户数据。
  >
  > PDFe is an offline desktop PDF reader/editor using a local PDFium engine. No network access, no data collection. runFullTrust lets this packaged Win32 app read/write local files the user picks: open PDFs, render thumbnails, export files.

## 5. 提交前检查清单

- [x] 300×300 一览图标 —— `docs/store-listing/StoreLogo-300x300.png`（勿用包内 50×50）
- [x] 16:9 超级英雄图（可选，非必填）—— `docs/store-listing/Hero-1920x1080.png` / `Hero-3840x2160.png`；无文字、无应用 UI、非图库照片
- [x] ≥4 张（主卡 01–09 + 可选补位，建议 8–10 张，上限 10 张）≥1366×768 PNG，中英各一套，逐张核对像素
      **2026-10-01 实测复核**：`docs/store-listing/screenshots/` 现有 4 对 8 张（`01-reader` / `02-search` / `03-annot` / `05-watermark`，各含 `-zh` / `-en`），逐张以 `System.Drawing` 读取尺寸均为 **1920×1080**（≥1366×768），中英成对无缺，单文件 266–409 KB。
- [x] 每张截图配 ≤200 字符说明，中英各一份 —— 9 张主卡的「说明（中）/（EN）」已写入 §2.3，补位 10/11 见其表格；2026-09-26 实测（按 Unicode 码点）：中文 21–36、英文 58–129，**全部 ≤200**，且 9 张卡中英成对无缺
- [x] 说明 / 简短说明 / 产品功能 中英双份文案落库 —— §3.1 简短说明、§3.2 说明、§3.3 产品功能（中英各 10 条）均已落库，实测字符数与上限比对见 §3 开头，全部达标
- [x] 短标题、排序标题、系统要求填写（拟填值见 §3.4，已随本轮提交认证一并填入 Partner Center）
- [x] 清单 Identity 替换后重新走 `Add-AppxPackage` 侧载自测（2026-09-27 实测通过，用商店身份包而非本地测试身份）
      清单注入 Partner Center 三值（`CCB6DC78.PDFe` / `CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F` / `老袁不圆润`）后，以自签名（新证书同为 `CN=D7439EB2-…`，指纹 `5B46459DE656E937606786A05732E7F21A247D3C`）侧载安装成功：`Add-AppxPackage` exit 0 → `CCB6DC78.PDFe_0.1.0.0_x64__hmyrrnnxy08dw`，`Status = Ok`；启动后进程 `pdfe` 存活、标题 `PDFe`、`Responding = True`，截屏确认界面正常渲染（工具栏 + 左栏缩略图/书签 + 空态），**非白屏**。
      **踩坑记录 1（证书信任范围）**：只把证书导入 `Cert:\CurrentUser\TrustedPeople` 不够，`Add-AppxPackage` 仍报 `0x800B0109`「根证书必须是受信任的证书」；必须装入 **`LocalMachine\TrustedPeople`**（需管理员 UAC）。
      **踩坑记录 2（自签名 Subject 必须等于清单 Publisher）**：商店身份包的 Publisher 是产品 GUID，故需新建 Subject 为 `CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F` 的证书；原 `CN=PDFe Local Test` 证书只适用于默认值的本地测试包。
      **踩坑记录 3（启动方式）**：`Start-Process "shell:appsFolder\<PFN>!App"` 报「系统找不到指定的文件」，`Start-Process explorer.exe -ArgumentList "shell:appsFolder\…"` 不报错但也不起进程；可用的是 Shell COM：`(New-Object -ComObject Shell.Application).NameSpace("shell:appsFolder").Items() | Where-Object { $_.Path -eq "<PFN>!App" } | ForEach-Object { $_.InvokeVerb("open") }`。另 `Invoke-CommandInDesktopPackage` 需提权，非必需。
      旧的本地测试身份包 `konnyyuan.pdfe` 已 `Remove-AppxPackage` 卸载，开始菜单保持单一「PDFe」入口。
      打包链路已于 2026-09-26 以 `-Sign None` 复验通过：`npm run build` → `cargo build --release` → 暂存布局 → `makeappx pack` 全程 exit 0；解包后包内 payload 与 `target\release\pdfe.exe`、`pdfium\pdfium.dll` 的 SHA256 逐一比对一致，清单占位符（`__PUBLISHER__` / `__VERSION__` / `__EXE__`）均已正确替换。
      同日追加：清单新增 `__IDENTITY_NAME__` / `__PUBLISHER_DISPLAY_NAME__` 两个占位符，脚本新增 `-IdentityName` / `-PublisherDisplayName` 参数（默认值为本地测试值），残留占位符检查正则放宽为 `__[A-Z_]+__`。已用 `-SkipBuild -Sign None` 传测试值实跑验证注入生效（`Identity/@Name`、`Publisher`、`PublisherDisplayName` 三处均替换为目标值、无残留），再用默认值 `-Sign SelfSigned` 复跑，产物签名状态仍为 **Valid**（复用 `CN=PDFe Local Test` 证书）。未签名包本身无法安装，故安装自测仍待签名后进行。
      2026-09-26 上架包实测：注入 Partner Center 三值出未签名包 `src-tauri\target\msix\PDFe_0.1.0_x64.msix`（7,076,158 字节，SHA256 `B27631719980CB1493A3F2E0568A0653953C51FE25851619D14B0B023B6A0F4C`，`Get-AuthenticodeSignature` = `NotSigned`），`Identity/@Name` / `Publisher` / `PublisherDisplayName` 三处与目标值逐字一致、无残留占位符。首轮上传被 Partner Center 校验拦截，唯一错误为 `PublisherDisplayName` 不匹配（包内是测试默认值 `PDFe`，产品为 `老袁不圆润`）——已按 §4 上表重建修复；顺带修正清单模板注释（占位符字面量不再写进注释，否则打包后被替换成值、注释自相矛盾）。**提交后该二进制不得再改动**，本地侧载自测请另跑一次默认值构建。
      ⚠️ **2026-09-27 复检发现首轮上传的是「白屏坏包」**：包内 `layout\pdfe.exe` 为 2026-09-26 09:13:51 的 **dev 模式**构建（8,003,072 字节；在该 exe 字节里搜 `assets/index-` 返回 -1，即前端 dist 未内嵌）。dev 模式下运行时只导航到 `devUrl`（`http://localhost:1420`），脱离 dev server 即白屏。根因 = 当时 `src-tauri/Cargo.toml` 缺 `custom-protocol` feature（`cfg!(not(feature="custom-protocol"))` 在编译期推导 `dev=true`），已修复并在打包脚本中固定传 `--features custom-protocol`。
      对照正确的 release 产物：`target\release\pdfe.exe` 8,114,688 字节（比 dev 版大约 +11 万字节），字节内可搜到 `/assets/index-D3lRW0em.css`（偏移 6990625）。
      ✅ **出上架包后必做的自检（2 条，缺一不可）**：① `layout\pdfe.exe` 字节中含 `assets/index-`（未内嵌 = dev 版，必须重打）；② `Get-AuthenticodeSignature <msix>` = `NotSigned`（上架包不签名）。另需核对 `layout\AppxManifest.xml` 的 `Identity/@Name`、`Identity/@Publisher`、`PublisherDisplayName` 三值与 Partner Center 逐字一致。
      **2026-09-27 已按上法重打包并全部自检通过**：`PDFe_0.1.0_x64.msix` **7,191,892 字节**（比坏包 +115,734，正对应内嵌的前端资源），SHA256 `D33A247CEE0BEF96D7FB68F75B67F53DAACBDA09699A0C9A7D555DEEC61511F9`，`Get-AuthenticodeSignature` = `NotSigned`；`layout\pdfe.exe` 8,114,688 字节且字节内含 `assets/index-` 与 `/assets/index-D3lRW0em.css`；清单 `Identity/@Name`=`CCB6DC78.PDFe`、`Identity/@Publisher`=`CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F`、`PublisherDisplayName`=`老袁不圆润`、`EntryPoint=Windows.FullTrustApplication`，无残留占位符。
      ⚠️ **上传给 Partner Center 的是未签名副本 `PDFe_0.1.0_x64.unsigned.msix`**（与上段同尺寸/同哈希：7,191,892 字节 / `D33A247C…` / `NotSigned`）。同名原件 `PDFe_0.1.0_x64.msix` 已在本地商店身份侧载自测中被**签名覆盖**（现为 7,194,886 字节 / SHA256 `DA847A45EE06B3BF76C19750984D1F9848353A403204F82F43E0E77AE3EEDB56`）——**切勿把签名后的同名文件传上去**。若原件被覆盖，用 `scripts\build-msix.ps1 -SkipBuild -Sign None -IdentityName CCB6DC78.PDFe -Publisher "CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F" -PublisherDisplayName <老袁不圆润>` 重出即可。旧包（SHA256 `B2763171…`，7,076,158 字节）作废，勿再上传。
- [x] Partner Center「提交选项」页填写受限功能 `runFullTrust` 用途说明并保存（文本见 §4，已随本轮提交认证一并保存，该页不再显示 Incomplete）
- [x] Partner Center 重新上传修复后的包（已改传未签名副本 `PDFe_0.1.0_x64.unsigned.msix`，7,191,892 字节 / SHA256 `D33A247C…`；首轮的 1 错误 `PublisherDisplayName` 已修复，应只剩 `runFullTrust` 警告）
- [x] 自签名签名 + 侧载安装自测（2026-09-26 实测通过）
      `scripts\build-msix.ps1 -Sign SelfSigned -Install`：复用已有自签名证书（`CN=PDFe Local Test`，指纹 `76F0CE79C05E03A9152FD5472C13405E80F137FB`，本机 `LocalMachine\TrustedPeople` 已信任）→ `signtool sign` 成功，`Get-AuthenticodeSignature` 状态 **Valid** → 侧载安装成功（`Status = Ok`，`C:\Program Files\WindowsApps\konnyyuan.pdfe_0.1.0.0_x64__6cgrzvqajzfpg`）→ 启动验证通过（进程 `pdfe` 存活、窗口标题 `PDFe`、`Responding = True`）。
      **踩坑记录**：同版本重装会报 `0x80073CFB`「提供的程序包已安装，且禁止重新安装该程序包…内容不相同」——本地自测迭代同一版本号时，须先 `Remove-AppxPackage konnyyuan.pdfe_0.1.0.0_x64__6cgrzvqajzfpg` 再 `Add-AppxPackage`（或提升 `tauri.conf.json` 的 `version`）。
- [x] Windows App 认证工具包（WACK）本地预检（2026-09-26 实测完成，判定 `OVERALL_RESULT="WARNING"`）
      `appcert.exe` 位于 `C:\Program Files (x86)\Windows Kits\10\App Certification Kit\`，**须管理员提权**（非提权会话直接报「requested operation requires elevation」），且只能针对已签名并安装的包运行（未签名包无法预检）。实测链路：`appcert.exe reset` → `appcert.exe test -packagefullname konnyyuan.pdfe_0.1.0.0_x64__6cgrzvqajzfpg -reportoutputpath <报告>`，exit 0；报告判定 `APP_TYPE="Centennial"`、`PARTIAL_RUN="FALSE"`，共 **24 项测试、22 项 PASS**，仅 2 项未通过：
      1. 【FAIL，但 `OPTIONAL="TRUE"` 可选项】`已阻止的可执行文件`（REQUIREMENT 25 / TEST 88）——命中 `kernel32.dll!CreateProcessW`、`shell32.dll!ShellExecuteW` / `ShellExecuteExW` 的 API 引用，以及二进制内的字符串 `cmd` / `cmd.exe` / `\cmd.exe` / `basH` / `Reg` / `CDB` / `CmD`。属启发式扫描：前三个 API 是桌面应用「打开文件 / 打开外部链接」的正常依赖，其余是打包进运行时的无害字符串，非真实问题；该项为可选项，不影响提交。
      2. 【WARNING，`OPTIONAL="FALSE"`】`DPIAwarenessValidation`（REQUIREMENT 26 / TEST 92）——报「未能处理二进制文件 pdfe.exe」「应用不是 DPI 感知应用」。已用 `mt.exe /inputresource:"<exe>";#1 /out:<xml>` 抽出发布版 exe 内嵌清单核实：清单**只含** `Microsoft.Windows.Common-Controls 6.0` 依赖，无 `<application>` / `dpiAware` / `dpiAwareness` 声明——这正是 Tauri v2 默认清单 `tauri-build/src/windows-app-manifest.xml` 的全部内容；同时 WACK 报告的 `AitCategory Id="ApiDynamic"` 里记录了 `user32.dll!SetProcessDpiAwarenessContext`，说明 tao/Rust 是在**运行时动态**设置 DPI 感知，静态清单检查看不到，故判定为 Tauri 应用的通性误报。若后续认证测试因此被卡，再考虑用 `tauri_build::WindowsAttributes::new().app_manifest(...)` 注入含 `PerMonitorV2` 的自定义清单。

### 5.1 提交当次操作清单（Partner Center 点击顺序）

> §5 回答「准备到什么程度」，本节回答「提交那一刻按什么顺序点」。逐项打勾，全绿再点 `提交认证`。

- [x] ① 结束/取消上一轮未竟的认证（若「认证」页仍有进行中的提交），并**删除旧包**（SHA256 `B2763171…`，7,076,158 字节，白屏坏包）
- [x] ② 上传修复后的包 **`PDFe_0.1.0_x64.unsigned.msix`**（[src-tauri/target/msix/](../src-tauri/target/msix/)，7,191,892 字节 / SHA256 `D33A247C…` / `NotSigned`）；**不要**传签名后的 `PDFe_0.1.0_x64.msix`（7,194,886 字节 / `DA847A45…`，那是本地自测产物）
- [x] ③ `提交选项` 页 → 受限功能 `runFullTrust` 用途说明填 §4 短版（291 字符）→ **点保存**（不保存该节恒为 Incomplete）
- [x] ④ `隐私政策 URL` 填 `https://qiangyuan1979.github.io/PDFe/store-listing/privacy-policy.html`（须以 `.html` 结尾，不能填 `.md`；提交前请先确认该地址返回 HTTP 200）
      **2026-10-01 已在 Partner Center 更新为新地址**：新地址实测 HTTP 200（15,295 B）；旧地址 `https://pdfreader001.github.io/pdfreader001/store-listing/privacy-policy.html` 亦仍 200（15,323 B），但其页面内联系方式指向已停用的 `pdfreader001/pdfreader001`，故弃用。注意：本轮已提交认证，该字段改动在**下一次提交**时生效；应用包内不含隐私政策 URL（见 `src/components/HelpPanel.tsx` 的 `PRIVACY_KEYS`，纯文本 + i18n），故无需重新打包。
- [x] ⑤ `商店一览` 逐语言填文案（§3.1 简短说明 / §3.2 说明 / §3.3 产品功能），上传 300×300 图标与 ≥4 张截图（§2）
- [x] ⑥ 补充字段：短标题 / 排序标题 / 语音标题 / 系统要求（§3.4）；`此版本中的新增功能` 首次提交**留空**
- [x] ⑦ `价格和可用性` / `属性` / `年龄分级` 按 §4 决策填写
- [x] ⑧ 所有页面 Incomplete 清零后点 **`提交认证`**；**提交后包二进制不得再改动**（已提交认证，结果待出）
