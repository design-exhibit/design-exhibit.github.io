import http from "node:http";
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = path.join(projectRoot, "site");
const port = Number(process.env.PORT || 4173);
const excelName = "项目链接清单.xlsx";
const preferredExcel = path.join(projectRoot, excelName);
const fallbackExcel = path.join(projectRoot, "data", excelName);
const excel = await fs.access(preferredExcel).then(() => preferredExcel).catch(() => fallbackExcel);
const parser = path.join(projectRoot, "scripts", "excel_to_json.py");
const output = path.join(root, "data", "projects.json");
const python = process.env.PYTHON || "python";
let revision = String(Date.now());
let generating = false;
let pending = false;
let debounceTimer;
let lastSignature = "";
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml"
};

function runParser() {
  return new Promise((resolve) => {
    const child = spawn(
      python,
      [parser, "--input", excel, "--output", output],
      { cwd: projectRoot, shell: false, stdio: "inherit" }
    );
    child.once("error", (error) => {
      console.error(`无法启动Excel解析器：${error.message}`);
      resolve(false);
    });
    child.once("exit", (code) => resolve(code === 0));
  });
}

async function sourceSignature() {
  const stats = await fs.stat(excel);
  return `${stats.size}:${stats.mtimeMs}`;
}

async function regenerate() {
  if (generating) {
    pending = true;
    return;
  }
  generating = true;
  do {
    pending = false;
    const signature = await sourceSignature().catch(() => "");
    if (signature && signature === lastSignature) continue;
    console.log(`正在读取：${excel}`);
    let succeeded = await runParser();
    if (!succeeded) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      succeeded = await runParser();
    }
    if (succeeded) {
      lastSignature = signature;
      revision = String(Date.now());
      console.log("数据已更新，网页将自动刷新。\n");
    } else {
      console.error("Excel解析失败，网页继续显示上一次有效数据。\n");
    }
  } while (pending);
  generating = false;
}

function liveReloadScript() {
  return `<script>
(() => {
  let revision = ${JSON.stringify(revision)};
  async function check() {
    try {
      const response = await fetch("/__dev_revision", { cache: "no-store" });
      if (response.ok) {
        const next = await response.text();
        if (next !== revision) {
          revision = next;
          location.reload();
          return;
        }
      }
    } catch {}
    setTimeout(check, 1000);
  }
  setTimeout(check, 1000);
})();
</script>`;
}

await regenerate();

watch(path.dirname(excel), (eventType, filename) => {
  const changedName = filename ? path.basename(filename.toString()) : "";
  if (changedName && changedName !== path.basename(excel)) return;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(regenerate, 700);
}).on("error", (error) => console.error(`Excel监听失败：${error.message}`));

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/__dev_revision") {
      response.writeHead(200, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(revision);
      return;
    }
    const requested = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const file = path.resolve(root, `.${requested}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error("非法路径");
    let content = await fs.readFile(file);
    if (path.extname(file) === ".html") {
      content = content.toString("utf8").replace("</body>", `${liveReloadScript()}</body>`);
    }
    const headers = { "Content-Type": mime[path.extname(file)] || "application/octet-stream" };
    if (path.extname(file) === ".html") headers["Cache-Control"] = "no-store";
    response.writeHead(200, headers);
    response.end(content);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("页面不存在");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`本地网站：http://127.0.0.1:${port}`);
  console.log(`保存“${excelName}”后，网页会自动更新。`);
});
