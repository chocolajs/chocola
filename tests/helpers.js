import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FIXTURE_BASIC = path.join(__dirname, "fixtures", "basic");

export async function mkTmpApp(files = {}) {
  const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-app-"));
  const tmpRoot = path.join(tmpParent, "app");
  await fs.mkdir(tmpRoot, { recursive: true });

  for (const [relPath, content] of Object.entries(files)) {
    const filePath = path.join(tmpRoot, ...relPath.split("/"));
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  return { tmpParent, tmpRoot };
}

export async function mkTmpFromFixture(name = "basic") {
  const tmpParent = await fs.mkdtemp(path.join(os.tmpdir(), "chocola-test-"));
  const tmpRoot = path.join(tmpParent, "app");
  await fs.cp(path.join(__dirname, "fixtures", name), tmpRoot, { recursive: true });
  return { tmpParent, tmpRoot };
}

export async function cleanupTmp(tmpParent) {
  await fs.rm(tmpParent, { recursive: true, force: true });
}

export async function listDir(dir) {
  try {
    return (await fs.readdir(dir)).sort();
  } catch {
    return [];
  }
}

export function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
