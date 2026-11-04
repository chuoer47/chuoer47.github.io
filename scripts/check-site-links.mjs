import fs from "node:fs";
import path from "node:path";

const root = path.resolve("docs/.vitepress/dist");
if (!fs.existsSync(path.join(root, "index.html"))) {
  throw new Error("请先构建站点，再运行 npm run docs:check。");
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}

function decode(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt);|&#(?:x[\da-f]+|\d+);/gi, (entity) => {
    const named = { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&lt;": "<", "&gt;": ">" };
    return named[entity] ?? String.fromCodePoint(entity[2].toLowerCase() === "x"
      ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10));
  });
}

const files = new Set(walk(root));
const pages = new Map();
for (const file of files) {
  if (!file.endsWith(".html")) continue;
  const html = fs.readFileSync(file, "utf8")
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "");
  pages.set(file, {
    ids: new Set([...html.matchAll(/\b(?:id|name)="([^"]*)"/g)].map((m) => decode(m[1]))),
    links: [...html.matchAll(/<(?:a|img)\b[^>]*\b(?:href|src)="([^"]*)"/g)].map((m) => decode(m[1])),
  });
}

const errors = new Set();
for (const [file, { links }] of pages) {
  for (const link of links) {
    if (!link || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link)) continue;
    try {
      const [pathname, fragment] = link.split("#");
      const decoded = decodeURIComponent(pathname.split("?")[0]);
      const base = !decoded ? file : decoded.startsWith("/")
        ? path.resolve(root, `.${decoded}`) : path.resolve(path.dirname(file), decoded);
      const target = [base, `${base}.html`, path.join(base, "index.html")].find((candidate) => files.has(candidate));
      const label = `${path.relative(root, file)} → ${link}`;
      if (!target) errors.add(`文件不存在: ${label}`);
      else if (fragment && pages.has(target) && !pages.get(target).ids.has(decodeURIComponent(fragment))) {
        errors.add(`锚点不存在: ${label}`);
      }
    } catch {
      errors.add(`无效链接: ${path.relative(root, file)} → ${link}`);
    }
  }
}
if (errors.size) {
  console.error([...errors].join("\n"));
  process.exitCode = 1;
} else {
  console.log(`站内链接、图片和锚点检查通过（${pages.size} 个页面）。`);
}
