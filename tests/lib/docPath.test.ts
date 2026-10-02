import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CODE_EXTS,
  EPUB_EXTS,
  HTML_EXTS,
  MARKDOWN_EXTS,
  PDF_EXTS,
  TEXT_AND_CODE_EXTS,
  TEXT_EXTS,
  fileExt,
  isPdfPath,
  nativeDocKind,
} from "../../src/lib/docPath.ts";

test("fileExt：取小写扩展名，兼容反斜杠路径", () => {
  assert.equal(fileExt("a.MD"), "md");
  assert.equal(fileExt("C:\\Users\\me\\report.PDF"), "pdf");
  assert.equal(fileExt("/home/u/archive.tar.gz"), "gz", "只取最后一段扩展名");
  assert.equal(fileExt("dir.with.dots/file.txt"), "txt", "目录名里的点不算");
});

test("fileExt：无扩展名与隐藏文件返回空串", () => {
  assert.equal(fileExt("README"), "");
  assert.equal(fileExt("/a/b/"), "");
  assert.equal(fileExt(".gitignore"), "", "点开头的隐藏文件视为无扩展名");
  assert.equal(fileExt("trailing."), "");
});

test("isPdfPath：仅 .pdf 交给 PDFium，大小写不敏感", () => {
  assert.equal(isPdfPath("a.pdf"), true);
  assert.equal(isPdfPath("A.PDF"), true);
  assert.equal(isPdfPath("C:\\x\\book.Pdf"), true);
  assert.equal(isPdfPath("a.pdfx"), false, "不得把 .pdfx 当成 PDF");
  assert.equal(isPdfPath("a.md"), false);
  assert.equal(isPdfPath("README"), false);
});

test("nativeDocKind：按扩展名映射到五类原生文档", () => {
  assert.equal(nativeDocKind("note.md"), "markdown");
  assert.equal(nativeDocKind("note.MARKDOWN"), "markdown");
  assert.equal(nativeDocKind("page.html"), "html");
  assert.equal(nativeDocKind("page.xhtml"), "html");
  assert.equal(nativeDocKind("book.epub"), "epub");
  assert.equal(nativeDocKind("data.json"), "text");
  assert.equal(nativeDocKind("conf.yaml"), "text");
  assert.equal(nativeDocKind("notes.txt"), "text");
  assert.equal(nativeDocKind("main.cpp"), "code");
  assert.equal(nativeDocKind("App.tsx"), "code");
  assert.equal(nativeDocKind("script.sh"), "code");
});

test("nativeDocKind：PDF 与不支持的格式返回 null", () => {
  assert.equal(nativeDocKind("doc.pdf"), null, "PDF 走 PDFium，不是原生文档");
  assert.equal(nativeDocKind("book.mobi"), null, "mobi/azw3 不在原生阅读范围");
  assert.equal(nativeDocKind("book.azw3"), null);
  assert.equal(nativeDocKind("README"), null);
  assert.equal(nativeDocKind(""), null);
});

test("扩展名表：各分组互不重叠，且都不含 pdf", () => {
  const groups: Record<string, string[]> = {
    markdown: MARKDOWN_EXTS,
    html: HTML_EXTS,
    epub: EPUB_EXTS,
    text: TEXT_EXTS,
    code: CODE_EXTS,
  };
  const seen = new Map<string, string>();
  for (const [name, exts] of Object.entries(groups)) {
    assert.ok(exts.length > 0, `${name} 分组不应为空`);
    for (const ext of exts) {
      assert.ok(!PDF_EXTS.includes(ext), `${name} 不应包含 pdf（会与 PDFium 路由冲突）`);
      assert.equal(seen.get(ext), undefined, `${ext} 同时出现在 ${seen.get(ext)} 与 ${name}`);
      seen.set(ext, name);
    }
  }
});

test("TEXT_AND_CODE_EXTS 为文本与源码两组之和且无重复", () => {
  assert.equal(TEXT_AND_CODE_EXTS.length, TEXT_EXTS.length + CODE_EXTS.length);
  assert.equal(new Set(TEXT_AND_CODE_EXTS).size, TEXT_AND_CODE_EXTS.length);
});
