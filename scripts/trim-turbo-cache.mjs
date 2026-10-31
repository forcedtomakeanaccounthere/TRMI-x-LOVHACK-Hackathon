import fs from "node:fs";
import path from "node:path";

const MAX_CACHE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

const CACHE_DIRS = [
  path.resolve("node_modules/.cache/turbo"),
  path.resolve(".turbo"),
  path.resolve("apps/frontend/.next/cache"),
  path.resolve("apps/backend/.turbo"),
  path.resolve("apps/ai/.turbo"),
];

export function trimCache(maxBytes = MAX_CACHE_BYTES) {
  let totalBytes = 0;
  const files = [];

  for (const dir of CACHE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    function walk(curr) {
      try {
        for (const entry of fs.readdirSync(curr, { withFileTypes: true })) {
          const full = path.join(curr, entry.name);
          try {
            if (entry.isDirectory()) {
              walk(full);
            } else if (entry.isFile()) {
              const stat = fs.statSync(full);
              totalBytes += stat.size;
              files.push({ path: full, size: stat.size, mtime: stat.mtimeMs });
            }
          } catch {}
        }
      } catch {}
    }
    walk(dir);
  }

  if (totalBytes > maxBytes) {
    // Sort oldest files first to prune least-recently-used cache entries
    files.sort((a, b) => a.mtime - b.mtime);
    let bytesToRemove = totalBytes - maxBytes;
    for (const file of files) {
      if (bytesToRemove <= 0) break;
      try {
        fs.unlinkSync(file.path);
        bytesToRemove -= file.size;
      } catch {}
    }
    console.log(`[cache] Trimmed cache to under ${Math.round(maxBytes / (1024 * 1024 * 1024))} GB.`);
  }
}

trimCache();
