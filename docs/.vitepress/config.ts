import { defineConfig } from "vitepress";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(__dirname, "..");
const postsRoot = path.resolve(docsRoot, "posts");

type SidebarItem = {
  text: string;
  link?: string;
  collapsed?: boolean;
  items?: SidebarItem[];
};

function getOrder(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/^---\s*\n[\s\S]*?^order:\s*(\d+)/m);
    return match ? parseInt(match[1], 10) : Infinity;
  } catch {
    return Infinity;
  }
}

function getTitle(filePath: string, fallback: string): string {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const match = content.match(/^---\s*\n[\s\S]*?^title:\s*["']?(.+?)["']?\s*$/m);
    return match ? match[1].trim() : fallback;
  } catch {
    return fallback;
  }
}

function toLink(filePath: string): string {
  const relPath = path.relative(docsRoot, filePath).replace(/\\/g, "/");
  return `/${relPath}`.replace(/(^|\/)(index|README)\.md$/, "$1").replace(/\.md$/, "");
}

function getEntryOrder(dir: string, entry: string): number {
  const filePath = path.join(dir, entry);
  const stat = fs.statSync(filePath);

  if (stat.isDirectory()) {
    const indexFile = path.join(filePath, "index.md");
    const readmeFile = path.join(filePath, "README.md");
    if (fs.existsSync(indexFile)) return getOrder(indexFile);
    if (fs.existsSync(readmeFile)) return getOrder(readmeFile);
    return Infinity;
  }

  return entry.endsWith(".md") ? getOrder(filePath) : Infinity;
}

function scanDir(dir: string): SidebarItem[] {
  if (!fs.existsSync(dir)) return [];
  const items: SidebarItem[] = [];
  const files = fs
    .readdirSync(dir)
    .filter((file) => !file.startsWith(".") && !file.endsWith(".disabled"));

  files.sort((a, b) => {
    const aPath = path.join(dir, a);
    const bPath = path.join(dir, b);
    const aIsDir = fs.statSync(aPath).isDirectory();
    const bIsDir = fs.statSync(bPath).isDirectory();
    const aOrder = getEntryOrder(dir, a);
    const bOrder = getEntryOrder(dir, b);

    if (aOrder !== bOrder) return aOrder - bOrder;

    if (aIsDir && !bIsDir) return -1;
    if (!aIsDir && bIsDir) return 1;

    return a.localeCompare(b, "zh-CN");
  });

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      const indexFile = path.join(filePath, "index.md");
      const readmeFile = path.join(filePath, "README.md");
      const directoryIndex = fs.existsSync(indexFile)
        ? indexFile
        : fs.existsSync(readmeFile)
          ? readmeFile
          : null;
      const children = scanDir(filePath);

      if (!children.length && !directoryIndex) continue;

      items.push({
        text: directoryIndex ? getTitle(directoryIndex, file) : file,
        link: directoryIndex ? toLink(directoryIndex) : undefined,
        collapsed: true,
        items: children,
      });
    } else if (file.endsWith(".md") && file !== "index.md" && file !== "README.md") {
      const title = getTitle(filePath, file.replace(/\.md$/, ""));
      items.push({ text: title, link: toLink(filePath) });
    }
  }

  return items;
}

export default defineConfig({
  title: "Chuoer47's Blog",
  description: "个人技术博客",
  ignoreDeadLinks: true,

  locales: {
    root: {
      label: "中文",
      lang: "zh-CN",
    },
  },

  markdown: {
    lineNumbers: true,
  },

  themeConfig: {
    logo: "/favicon.ico",
    outline: {
      level: [2, 3],
    },
    nav: [
      { text: "首页", link: "/" },
      { text: "课程笔记", link: "/posts/课程笔记/" },
      { text: "算法", link: "/posts/算法/" },
      { text: "前后端", link: "/posts/前后端/" },
      { text: "项目", link: "/posts/项目/" },
      { text: "LLM 基础", link: "/posts/LLM基础/" },
      { text: "Agent", link: "/posts/Agent/" },
      { text: "AI Infra", link: "/posts/AI%20Infra/" },
      { text: "工具", link: "/posts/工具/" },
    ],

    sidebar: {
      "/posts/": scanDir(postsRoot),
    },

    socialLinks: [
      { icon: "github", link: "https://github.com/chuoer47" },
    ],
  },
});
