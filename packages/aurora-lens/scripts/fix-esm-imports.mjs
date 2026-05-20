import { readdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const distDir = "dist";

for await (const file of walk(distDir)) {
  if (extname(file) !== ".js") {
    continue;
  }

  const source = await readFile(file, "utf8");
  const fixed = source.replace(
    /(from\s+["'])(\.[^"']*?)(["'])/g,
    (_match, prefix, specifier, suffix) => `${prefix}${withJsExtension(specifier)}${suffix}`,
  );

  if (fixed !== source) {
    await writeFile(file, fixed);
  }
}

async function* walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
      continue;
    }
    yield path;
  }
}

function withJsExtension(specifier) {
  if (!specifier.startsWith(".") || hasExtension(specifier)) {
    return specifier;
  }
  return `${specifier}.js`;
}

function hasExtension(specifier) {
  const lastSegment = specifier.split("/").pop() ?? "";
  return /\.[A-Za-z0-9]+$/.test(lastSegment);
}
