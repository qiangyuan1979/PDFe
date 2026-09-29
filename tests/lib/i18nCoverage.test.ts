import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// i18n.ts 以中文原文为 key，`translate()` 查不到 key 时静默回退中文原文，
// 漏译不会报错也不会告警。这里静态扫描 src 中的 `t("...")` 字面量，
// 确保 en / ja 字典没有漏译。
// 动态 key（`t(someVar)`）无法静态解析，不在覆盖范围内。

const root = process.cwd();
const i18nPath = path.join(root, "src", "i18n.ts");

/** 从字典块中提取键。键可以是带引号的字符串，也可以是裸标识符（中文是合法 JS 标识符）。 */
function extractKeys(block: string): Set<string> {
  const keys = new Set<string>();
  const re = /^\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^:\n]+?))\s*:\s*(?:"|'|`)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    keys.add(m[1] ?? m[2] ?? (m[3] ?? "").trim());
  }
  return keys;
}

function collectSources(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSources(p, out);
    else if (/\.tsx?$/.test(entry.name) && entry.name !== "i18n.ts") out.push(p);
  }
}

const source = fs.readFileSync(i18nPath, "utf8");
const enStart = source.indexOf("const en: Record<string, string> = {");
const jaStart = source.indexOf("const ja: Record<string, string> = {");
const localeStart = source.indexOf("export type Locale");

const used = new Map<string, Set<string>>();
const files: string[] = [];
collectSources(path.join(root, "src"), files);
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const re = /\bt\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`([^`\\]*)`)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const key = m[1] ?? m[2] ?? m[3];
    if (key === undefined) continue;
    const rel = path.relative(root, file).replace(/\\/g, "/");
    const where = used.get(key) ?? new Set<string>();
    where.add(rel);
    used.set(key, where);
  }
}

function report(missing: string[]): string {
  return missing.map((k) => `  ${k}  <- ${[...(used.get(k) ?? [])].join(", ")}`).join("\n");
}

test("i18n：src 中用到的文案在 en / ja 字典中都有译条目", () => {
  assert.ok(
    enStart >= 0 && jaStart > enStart && localeStart > jaStart,
    "i18n.ts 结构已变化（en / ja / Locale 定位失败），请同步更新本测试",
  );

  const enKeys = extractKeys(source.slice(enStart, jaStart));
  const jaKeys = extractKeys(source.slice(jaStart, localeStart));
  assert.ok(enKeys.size > 0 && jaKeys.size > 0, "i18n.ts 字典解析为空，请同步更新本测试");

  const enMissing = [...used.keys()].filter((k) => !enKeys.has(k)).sort();
  const jaMissing = [...used.keys()].filter((k) => !jaKeys.has(k)).sort();

  assert.equal(enMissing.length, 0, `en 漏译 ${enMissing.length} 条：\n${report(enMissing)}`);
  assert.equal(jaMissing.length, 0, `ja 漏译 ${jaMissing.length} 条：\n${report(jaMissing)}`);
});
