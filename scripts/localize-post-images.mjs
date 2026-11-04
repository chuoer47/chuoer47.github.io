import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const postsRoot = path.join(root, "docs", "posts");
const reportPath = path.join(root, ".cache", "post-image-report.json");
const dryRun = process.argv.includes("--dry-run");

const imageRe = /!\[([^\]]*)\]\(([^)\n]*)\)/g;
const userAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function walkMarkdown(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".") || ent.name.endsWith(".assets")) continue;
    const filePath = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walkMarkdown(filePath));
    else if (ent.isFile() && ent.name.endsWith(".md")) out.push(filePath);
  }
  return out.sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function sanitizeBaseName(fileName) {
  return path
    .basename(fileName, ".md")
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "post";
}

function stripUrlDecorations(rawUrl) {
  const hashIndex = rawUrl.indexOf("#");
  return hashIndex === -1 ? rawUrl : rawUrl.slice(0, hashIndex);
}

function inferExtension(rawUrl, contentType) {
  const cleanUrl = stripUrlDecorations(rawUrl);
  try {
    const pathname = new URL(cleanUrl).pathname.toLowerCase();
    const ext = path.extname(pathname);
    if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".avif", ".bmp"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  } catch {
    // Fall through to content-type.
  }

  const type = (contentType || "").split(";")[0].trim().toLowerCase();
  if (type === "image/jpeg") return ".jpg";
  if (type === "image/png") return ".png";
  if (type === "image/gif") return ".gif";
  if (type === "image/webp") return ".webp";
  if (type === "image/svg+xml") return ".svg";
  if (type === "image/avif") return ".avif";
  if (type === "image/bmp") return ".bmp";
  return ".png";
}

function normalizeImageUrl(rawUrl) {
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";
  if (!/^https?:\/\//i.test(trimmed)) return "";
  return stripUrlDecorations(trimmed);
}

function relativeMarkdownPath(fromFile, toFile) {
  const rel = path.relative(path.dirname(fromFile), toFile).replace(/\\/g, "/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

function uniqueTargetPath(dir, preferredName) {
  const ext = path.extname(preferredName);
  const stem = path.basename(preferredName, ext);
  let candidate = path.join(dir, preferredName);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${String(index).padStart(2, "0")}${ext}`);
    index += 1;
  }
  return candidate;
}

function existingDownloadedImage(dir, url) {
  if (!fs.existsSync(dir)) return "";
  const key = crypto.createHash("sha256").update(url).digest("hex").slice(0, 10);
  return fs.readdirSync(dir).find((name) => name.includes(key)) || "";
}

async function fetchImage(url) {
  const headers = {
    "user-agent": userAgent,
    accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
  };

  let response = await fetch(url, { headers, redirect: "follow" });
  if (response.status === 403) {
    response = await fetch(url, {
      headers: { ...headers, referer: "https://blog.csdn.net/" },
      redirect: "follow",
    });
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (!buffer.length) throw new Error("empty response");

  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    const looksLikeSvg = buffer.subarray(0, 128).toString("utf8").includes("<svg");
    if (!looksLikeSvg) throw new Error(`not image: ${contentType}`);
  }

  return { buffer, contentType };
}

async function main() {
  const files = walkMarkdown(postsRoot);
  const failures = [];
  let remoteRefs = 0;
  let localizedRefs = 0;
  let downloaded = 0;
  let reused = 0;
  let skippedEmpty = 0;

  for (const filePath of files) {
    const oldContent = fs.readFileSync(filePath, "utf8");
    const replacements = [];
    let match;
    let ordinal = 1;

    while ((match = imageRe.exec(oldContent))) {
      const [whole, alt, target] = match;
      const rawUrl = target.trim();
      if (!rawUrl) {
        skippedEmpty += 1;
        continue;
      }

      const url = normalizeImageUrl(rawUrl);
      if (!url) continue;
      remoteRefs += 1;

      const assetsDir = path.join(path.dirname(filePath), `${sanitizeBaseName(path.basename(filePath))}.assets`);
      let targetPath;

      try {
        const existing = existingDownloadedImage(assetsDir, url);
        if (existing) {
          targetPath = path.join(assetsDir, existing);
          reused += 1;
        } else {
          const { buffer, contentType } = await fetchImage(url);
          const hash = crypto.createHash("sha256").update(buffer).digest("hex");
          const extension = inferExtension(url, contentType);
          const urlKey = crypto.createHash("sha256").update(url).digest("hex").slice(0, 10);
          const fileName = `image-${String(ordinal).padStart(3, "0")}-${urlKey}-${hash.slice(0, 10)}${extension}`;
          fs.mkdirSync(assetsDir, { recursive: true });
          targetPath = uniqueTargetPath(assetsDir, fileName);
          if (!dryRun) fs.writeFileSync(targetPath, buffer);
          downloaded += 1;
          await delay(20);
        }

        const newTarget = relativeMarkdownPath(filePath, targetPath);
        replacements.push({
          start: match.index,
          end: match.index + whole.length,
          text: `![${alt}](${newTarget})`,
        });
        localizedRefs += 1;
      } catch (error) {
        failures.push({
          file: path.relative(root, filePath),
          url,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      ordinal += 1;
    }

    if (replacements.length) {
      let newContent = "";
      let last = 0;
      for (const replacement of replacements) {
        newContent += oldContent.slice(last, replacement.start);
        newContent += replacement.text;
        last = replacement.end;
      }
      newContent += oldContent.slice(last);
      if (!dryRun && newContent !== oldContent) fs.writeFileSync(filePath, newContent);
    }
  }

  if (!dryRun) {
    writeJson(reportPath, { remoteRefs, localizedRefs, downloaded, reused, skippedEmpty, failures });
  }

  console.log(
    JSON.stringify(
      { remoteRefs, localizedRefs, downloaded, reused, skippedEmpty, failures: failures.length, dryRun },
      null,
      2,
    ),
  );

  if (failures.length) {
    console.log(`Report: ${path.relative(root, reportPath)}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
