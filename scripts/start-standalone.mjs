import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const standaloneRoot = path.join(projectRoot, ".next", "standalone");

await mkdir(path.join(standaloneRoot, ".next"), { recursive: true });
await cp(path.join(projectRoot, "public"), path.join(standaloneRoot, "public"), {
  recursive: true,
  force: true,
});
await cp(path.join(projectRoot, ".next", "static"), path.join(standaloneRoot, ".next", "static"), {
  recursive: true,
  force: true,
});

// A local Next build can copy dotenv files into the traced folder. E2E must
// consume only the explicit process environment, just like the Docker image.
for (const entry of await readdir(standaloneRoot)) {
  if (entry === ".env" || entry.startsWith(".env.")) {
    await rm(path.join(standaloneRoot, entry), { force: true });
  }
}

process.chdir(standaloneRoot);
await import(pathToFileURL(path.join(standaloneRoot, "server.js")).href);
