import { readFileSync, writeFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
if (typeof manifest.version !== "string" || !manifest.version) {
  throw new Error("package.json must contain a nonempty version");
}
const source = new URL("../src/parse.ts", import.meta.url);
const current = readFileSync(source, "utf8");
const declaration = /export const IMPORTER_VERSION = "[^"]+";/g;
if ([...current.matchAll(declaration)].length !== 1) {
  throw new Error("Expected exactly one IMPORTER_VERSION declaration");
}
const next = current.replace(
  declaration,
  () => `export const IMPORTER_VERSION = ${JSON.stringify(manifest.version)};`,
);
if (next !== current) writeFileSync(source, next);
