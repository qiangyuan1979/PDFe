# PDFe

桌面 PDF 编辑器（Windows），基于 **Tauri 2 + React + TypeScript + Rust + PDFium**。

## 状态

**功能完整度（参考 [docs-internal/superpowers/plans/2026-09-18-implementation-plan.md](docs-internal/superpowers/plans/2026-09-18-implementation-plan.md)）**：

- ✅ **M0** 环境与骨架
- ✅ **M1** 文档核心管线（PDFium 集成、打开/保存、撤销栈）
- ✅ **M2** 阅读器 UI（三栏布局、缩略图、搜索高亮、主题）
- ✅ **M3** 页面管理 + 合并拆分（旋转/删除/重排/提取、合并向导、拆分）
- ✅ **M4** 水印（添加/去除 - 自动检测 + 手动框选）
- ✅ **M5** 深度编辑（双击文字重写、新增文本框、图片替换、扫描版检测）
- ✅ **M6** 安全 + 导出（明文副本、内存去加密、PNG/JPEG 导出含 DPI）
- ✅ **M7** 打磨（性能优化、错误处理 review、性能基线）+ MSIX 打包与 Store 认证提交（结果待出）
- ✅ **P1** 快捷键体系（Ctrl+1/2/3 视图、Ctrl+Shift+L 中英日三语循环）
- ✅ **P2** 批注功能（6 种类型：高亮/下划线/删除线/便签/自由文本/矩形）
- ✅ **P3** 多语言扩展（中英日三语 i18n）
- ✅ **P4** OCR 占位 + 文档诊断面板（页数/大小/加密/扫描抽样/注释总数）
- ✅ **P7** 端到端测试（8 跨模块业务场景）
- ✅ **P8** OCR 真做（可选 feature：Tesseract 识别 + 搜索层写回）

### P8 OCR（可选 feature）

对扫描版 PDF 调用 **Tesseract OCR** 识别文字，结果以透明文本层（`fill alpha=0`）写回 PDF，
生成可搜索/可选择文本的 searchable PDF。

```bash
# 默认不引入 OCR（避免 C++ 依赖 + 50MB 二进制膨胀）
cargo build

# 启用 OCR：需系统已安装 cmake + 预编译 libtesseract + tessdata 语言包
# Windows：安装 tesseract-ocr（含 eng.traineddata 约 30MB）
cargo build --features ocr
```

核心设计：
- `ocr` feature 门控 `tesseract` crate，默认关闭
- `ocr.rs` 模块始终编译；feature off 时 commands 返回 `ocr_unavailable` 错误
- 文本层用 `set_fill_color(alpha=0)` 透明填充实现"不可见"（pdfium-render 0.8.37 的
  `set_render_mode(Invisible)` 会破坏文本对象导致 garbage 输出）
- 字体复用 `watermark::load_font_for_text`，ASCII 自动选 `helvetica` 标准字体

## 打包

Tauri 2 在 Windows 下的 `bundle.targets = "all"` 只产出 msi + nsis，**不产出 MSIX**。
MSIX 由脚本手工完成（`makeappx` pack → `signtool` sign）：

```powershell
# 自签名 + 打包（本机侧载测试）
powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1

# 自签名 + 打包 + 信任证书 + 安装验证（需写本机信任存储，会弹 UAC）
powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Install

# 用正式代码签名证书
powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Sign Pfx -PfxPath C:\certs\pdfe.pfx -PfxPassword 你的密码

# 只出未签名包（留给分发方签名）
powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Sign None

# 出提交 Microsoft Store 的正式包：注入 Partner Center「产品标识」三个值，由微软重签
powershell -ExecutionPolicy Bypass -File scripts\build-msix.ps1 -Sign None `
  -IdentityName CCB6DC78.PDFe `
  -Publisher "CN=D7439EB2-4E51-48CF-A6CB-58843AEEF25F" `
  -PublisherDisplayName "老袁不圆润"
```

清单模板在 `src-tauri/msix/AppxManifest.xml`（full-trust Win32：
`EntryPoint="Windows.FullTrustApplication"` + `rescap:runFullTrust`），
脚本会替换 `__IDENTITY_NAME__` / `__PUBLISHER__` / `__PUBLISHER_DISPLAY_NAME__` /
`__VERSION__` / `__EXE__` 五个占位符（前三个有对应参数，默认值为本地测试值），
并把 `pdfium.dll` 一并暂存到包内**与 exe 同级**（`document.rs::pdfium_library_path()`
优先在 exe 目录查找，装到别的机器后编译期路径失效）。

产物：`src-tauri/target/msix/PDFe_<version>_x64.msix`。

> 注意：`Publisher` 必须与签名证书 Subject 完全一致，否则 `Add-AppxPackage`
> 会报「清单中的 Publisher 与签名证书不匹配」。
> `-Install` 时自签名证书需装入**本机** `LocalMachine\TrustedPeople`：AppXSVC
> 以服务账户运行，读不到 `CurrentUser` 的证书存储；缺失时会报
> `0x800B0109 应用包或捆绑包中的签名的根证书必须是受信任的证书`。
> 该写入需要管理员权限，脚本在非管理员终端下会自动请求提权（弹 UAC）。
> **已提交 Microsoft Store 认证（结果待出）** —— 上架包用 `-IdentityName` / `-Publisher` /
> `-PublisherDisplayName` 注入 Partner Center 分配的产品标识并由微软重签；自备证书只用于本机侧载。
> ⚠️ 提交后包二进制不得再改动。中文 `PublisherDisplayName` 直接写在命令行可能被 PowerShell 5.1
> 按 GBK 解码成乱码，建议写成 UTF-8 文件后用 `[System.IO.File]::ReadAllText(..., UTF8)` 读入再传参。
> 三个标识值与踩坑记录见 [docs-internal/store-listing-materials.md](docs-internal/store-listing-materials.md) §4。

## 测试

| 类型 | 数量 | 位置 |
|------|------|------|
| Rust 单元测试（lib） | **162** | `src-tauri/src/`（`cargo test --lib`） |
| Rust 集成测试 | **173** | `src-tauri/tests/`（不含 E2E/性能；含 `commands.rs` 命令层 6 场景） |
| Rust 端到端 (E2E) | **8 场景** | `src-tauri/tests/e2e.rs` |
| TypeScript 类型检查 | 0 错误 | `npx tsc --noEmit` |
| 性能基线（2/100/500 页） | 20 项 | `src-tauri/tests/perf.rs`、`perf_memory.rs` |

合计 **363** 项 Rust 测试（lib 162 + 集成 173 + E2E 8 + 性能 20），`cargo test -- --test-threads=1` 全绿。

> ⚠️ 必须加 `--test-threads=1`：PDFium 非线程安全，并行跑会随机触发 `STATUS_HEAP_CORRUPTION`（0xc0000374）。

E2E 测试覆盖跨模块业务场景：打开→浏览/搜索→编辑（注释/文本重写）→重开验证；不启动 Tauri runtime，直接调用各模块的 `_logic` 纯函数，验证 bytes 跨步骤流转 + 持久化正确。

`commands.rs` 是命令层集成测试，走 `tauri::test` mock 运行时直调真实 `#[tauri::command]`，覆盖完整 IPC 链路（打开→加注释→保存→撤销/重做→关闭），实测 `AppState` 编排（撤销栈封顶 20、新编辑清空 redo、关闭后句柄失效）。

运行：
```bash
# 后端
cd src-tauri
cargo test -- --test-threads=1    # 首次会生成 large_100/500.pdf fixture
cargo test --test e2e             # 仅跑 E2E 场景
cargo test --test commands        # 仅跑命令层集成测试
cargo clippy --all-targets        # 提交前门禁：应零告警

# 前端
npx tsc --noEmit
```

提交前门禁：`cargo clippy --all-targets` 必须零告警（含测试目标）。该门禁于 M7 接入，当时一次性清掉 54 条存量告警（mechanical lint 为主，53 处 rustfix 自动修复 + 1 处手工改写），此后新增代码须保持零告警。

## 架构

```
src/                      # 前端（React + TypeScript）
  components/
    Canvas.tsx           # 画布 + PageView（精细订阅 + React.memo）
    Toolbar.tsx          # 顶部工具栏
    SearchPanel.tsx       # 搜索面板
    TaskPanel.tsx         # 所有任务面板（合并/拆分/水印/编辑/安全/导出）
    ThumbnailPanel.tsx   # 缩略图（虚拟滚动 + useCallback + close 释放显存）
  state/store.ts          # zustand 单一数据源
  lib/
    ipc.ts                # Tauri invoke 封装
    bitmapCache.ts        # LRU + ImageBitmap.close() 显存释放
  i18n.ts                 # 中英文 + translateError

src-tauri/src/
  render.rs               # 渲染 + 文本提取 + 搜索 + pick_text
  edit_ext.rs             # 深度编辑（M5，纯函数 + Tauri command）
  watermark_remove.rs     # 水印去除（M4）
  pages.rs                # 页面操作（M3）
  watermark.rs            # 加水印（M4）
  document.rs             # 文档打开/关闭/撤销/重做
  security.rs             # 安全状态 + 明文副本（M6）
  convert.rs              # PNG/JPEG 导出 + 图片合并为 PDF（M6）
  error.rs                # AppError 43 个 code + i18n code 一致性
  lib.rs                  # 命令注册入口
```

## 开发约定

- 所有后端命令走 `AppError` + 前端 `translateError()` 本地化
- 大操作前 `push_snapshot()`，前端 `setUndoRedo(refreshUndoRedo(id))`
- 选区坐标：CSS 像素（左上原点）/ PDF 点（左下原点），转换公式见 `.trae/skills/pdfe-milestone-delivery/SKILL.md`
- 提交规范：`feat|fix|docs|test|chore(scope): 描述`

## 推荐 IDE 配置

- VS Code + Tauri 扩展 + rust-analyzer