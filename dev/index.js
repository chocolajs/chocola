import http from "http";
import fs from "fs";
import path from "path";
import chalk from "../compiler/chalk.js";
import compile from "../compiler/index.js";
import { loadConfig, resolvePaths } from "../compiler/config.js";
import { getConfig } from "../utils.js";

export async function serve(__rootdir) {
  await compile(__rootdir);

  let __outdir = "dist";
  let __config = {
    hostname: "localhost",
    port: 3000,
  }

  let lastBuildTime = Date.now();

  const fullConfig = await getConfig(__rootdir);
  const config = await loadConfig(__rootdir);
  const paths = resolvePaths(__rootdir, config);
  const devConfig = fullConfig.dev;

  if (devConfig.hostname) { __config.hostname = devConfig.hostname }
  else { console.warn(chalk.bold.yellow("WARNING!"), `hostname not defined in chocola.config.json file: using default ${__config.hostname} hostname.`) }

  if (devConfig.port) { __config.port = devConfig.port }
  else { console.warn(chalk.bold.yellow("WARNING!"), `port not defined in chocola.config.json file: using default ${__config.port} port.`) }

  const srcDir = paths.src;

  let compileTimeout;
  const scheduleRecompile = () => {
    clearTimeout(compileTimeout);
    compileTimeout = setTimeout(async () => {
      try {
        await compile(__rootdir, { isHotReload: true });
        lastBuildTime = Date.now();
        console.log(chalk.green("✓"), "Hot reload: compiled successfully");
      } catch (error) {
        console.error(chalk.red("✗"), "Hot reload compilation failed:", error.message);
      }
    }, 300);
  };


  fs.watch(srcDir, { recursive: true }, (eventType, filename) => {
    if (filename && !filename.includes("node_modules")) {
      scheduleRecompile();
    }
  });

  const server = http.createServer((req, res) => {
    if (req.url === "/api/hot-reload") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ buildTime: lastBuildTime }));
      return;
    }

    let filePath = path.join(
      __outdir,
      req.url === "/" ? "index.html" : req.url
    );

    const extname = String(path.extname(filePath)).toLowerCase();
    const mimeTypes = {
      ".html": "text/html",
      ".htm": "text/html",
      ".js": "text/javascript",
      ".css": "text/css",
      ".csv": "text/csv",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpg",
      ".jpeg": "image/jpeg",
      ".bmp": "image/bmp",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".icon": "image/vnd.microsoft.icon",
      ".pdf": "application/pdf",
      ".mp3": "audio/mpeg",
      ".md": "text/markdown",
      ".mp4": "video/mp4",
      ".mpeg": "video/mpeg",
      ".oga": "audio/ogg",
      ".ogv": "video/ogg",
      ".php": "application/x-httpd-php",
      ".rar": "application/vnd.rar",
      ".tar": "application/x-tar",
      ".ttf": "font/ttf",
      ".txt": "text/plain",
      ".wav": "audio/wav",
      ".weba": "audio/webm",
      ".webm": "video/webm",
      ".webmanifest": "application/manifest+json",
      ".webp": "image/webp",
      ".xhtml": "application/xhtml+xml",
      ".xml": "application/xml",
      ".zip": "application/zip"
    };

    const contentType = mimeTypes[extname] || "application/octet-stream";

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code === "ENOENT") {
          res.writeHead(404, { "Content-Type": "text/html" });
          res.end("<h1>404 Not Found</h1><p>The requested resource was not found on this server.</p>", "utf-8");
        } else {
          res.writeHead(500);
          res.end("Internal server error: " + error.code);
        }
      } else {
        if (extname === ".html" || extname === ".htm") {
          const hotReloadScript = `
<script>
(function() {
  let lastBuildTime = ${lastBuildTime};
  setInterval(async () => {
    try {
      const res = await fetch('/api/hot-reload');
      const data = await res.json();
      if (data.buildTime > lastBuildTime) {
        lastBuildTime = data.buildTime;
        console.log('[Hot Reload] Changes detected, reloading...');
        window.location.reload();
      }
    } catch (e) {
      console.error('[Hot Reload] Check failed:', e);
    }
  }, 1000);
})();
</script>`;
          const htmlWithReload = content.toString().replace('</body>', hotReloadScript + '</body>');
          res.writeHead(200, { "Content-Type": contentType });
          res.end(htmlWithReload, "utf-8");
        } else {
          res.writeHead(200, { "Content-Type": contentType });
          res.end(content, "utf-8");
        }
      }
    });
  });

  server.listen(__config.port, __config.hostname, () => {
    console.log('Live server running at', chalk.hex("#68C4EE").underline(`http://${__config.hostname}:${__config.port}/`));
  });
}

/**
 * An intrinsic object that contains the Chocola Dev methods.
 */
export const dev = {
  /**
*  Initializes your Chocola dev server using a root directory.
* 
* ```js
* import { app } from "chocola/compiler"
import path from "path";
import { fileURLToPath } from "url";
 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
 
app.build(__dirname);
```
* @example
* @param {PathLike} __rootdir the directory where your Chocola App is
*/
  async server(__rootdir) { return serve(__rootdir) }
};