import { readArchive } from "./archive.js";
import { fail, HighTexImportError } from "./errors.js";
import { readManifest } from "./manifest.js";
import { readProfile } from "./profile.js";
import {
  chapterContent,
  createJsonReader,
  getLimits,
  object,
  string,
} from "./validation.js";
import type {
  BinaryAsset,
  ImportedHighTexV2,
  ImportValidationOptions,
} from "./types.js";

export const IMPORTER_VERSION = "0.1.0";
const chapterName = (name: string) =>
  name === "id" ? "abstract" : name === "en" ? "abstract-en" : name;
const front = ["abstract", "abstract-en", "foreword", "presentation"];
function order(id: string): number {
  return front.includes(id)
    ? front.indexOf(id)
    : /^(0|[1-9]\d*)$/.test(id)
      ? 4
      : id === "reference"
        ? 6
        : id === "attachment"
          ? 7
          : 5;
}
function compareIds(a: string, b: string): number {
  const rank = order(a) - order(b);
  if (rank) return rank;
  if (order(a) === 4 && a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
const webp = (bytes: Uint8Array): BinaryAsset => ({
  bytes,
  mime: "image/webp",
});

export function parseHighTexV2(
  input: Uint8Array | ArrayBuffer,
  options: ImportValidationOptions = {},
): ImportedHighTexV2 {
  const limits = getLimits(options);
  const bytes =
    input instanceof Uint8Array
      ? input
      : input instanceof ArrayBuffer
        ? new Uint8Array(input)
        : fail("invalid_archive", "Expected Uint8Array or ArrayBuffer");
  const entries = readArchive(bytes, limits);
  const json = createJsonReader(entries, limits);
  let manifest;
  try {
    manifest = readManifest(json("manifest.json"));
  } catch (error) {
    if (error instanceof HighTexImportError && error.code === "invalid_content")
      fail("invalid_manifest", error.message, error.path);
    throw error;
  }
  const doc = manifest.document;
  const chapters: ImportedHighTexV2["chapters"] = [];
  const images: Record<string, BinaryAsset> = Object.create(null);
  const ids = new Set<string>();
  for (const path of Object.keys(entries).sort()) {
    if (path.startsWith("files/chapters/")) {
      const match = /^files\/chapters\/([^/]+)\.json$/.exec(path);
      if (!match)
        fail(
          "unsupported_format",
          "Chapters must be JSON files directly inside files/chapters",
          path,
        );
      const id = chapterName(match[1]);
      if (ids.has(id))
        fail(
          "duplicate_chapter",
          "Chapter IDs collide after normalization",
          path,
        );
      ids.add(id);
      chapters.push({ id, content: chapterContent(json(path), path, options) });
    } else if (path.startsWith("files/assets/images/")) {
      const match = /^files\/assets\/images\/([^/]+)\.webp$/.exec(path);
      if (!match)
        fail(
          "unsupported_format",
          "Only WebP image entries are supported",
          path,
        );
      images[match[1]] = webp(entries[path]);
    }
  }
  chapters.sort((a, b) => compareIds(a.id, b.id));
  const configPath = "files/config.json";
  const config = entries[configPath]
    ? object(json(configPath), configPath)
    : {};
  for (const field of ["consentDate", "validityDate", "statementDate"])
    if (
      config[field] !== undefined &&
      config[field] !== null &&
      (typeof config[field] !== "string" ||
        !Number.isFinite(Date.parse(config[field] as string)))
    )
      fail("invalid_content", "Invalid date string", `${configPath}.${field}`);
  if (config.intern !== undefined && config.intern !== null) {
    const intern = object(config.intern, `${configPath}.intern`);
    if (
      intern.validity !== undefined &&
      intern.validity !== null &&
      (typeof intern.validity !== "string" ||
        !Number.isFinite(Date.parse(intern.validity as string)))
    )
      fail(
        "invalid_content",
        "Invalid date string",
        `${configPath}.intern.validity`,
      );
  }
  const references: Record<string, string> = Object.create(null);
  const referencePath = "files/assets/references.json";
  if (entries[referencePath]) {
    const raw = json(referencePath);
    const dictionary =
      Array.isArray(raw) && raw.length === 0 ? {} : object(raw, referencePath);
    for (const [key, value] of Object.entries(dictionary))
      references[key] = string(value, `${referencePath}.${key}`);
  }
  const list = (path: string, keyField: "name" | "key") => {
    if (!entries[path]) return [];
    const value = json(path);
    if (!Array.isArray(value))
      fail("invalid_content", "Expected an array", path);
    const keys = new Set<string>();
    return value.map((item, index) => {
      const record = object(item, `${path}[${index}]`);
      const key = string(record[keyField], `${path}[${index}].${keyField}`);
      if (!key || keys.has(key))
        fail("invalid_content", "Keys must be nonempty and unique", path);
      keys.add(key);
      return { key, value: string(record.value, `${path}[${index}].value`) };
    });
  };
  const profilePath = "files/profile.json";
  const profile = entries[profilePath]
    ? readProfile(json(profilePath), profilePath)
    : manifest.profile;
  return {
    importerVersion: IMPORTER_VERSION,
    manifest,
    document: {
      id: doc.id,
      title: doc.title?.id ?? "Imported Document",
      altTitle: doc.title?.en ?? "",
      ...(doc.category !== undefined ? { category: doc.category } : {}),
      keywords: {
        indonesian: doc.keywords?.id ?? [],
        english: doc.keywords?.en ?? [],
      },
    },
    chapters,
    config,
    references,
    images,
    variables: list("files/assets/variables.json", "name").map(
      ({ key, value }) => ({ name: key, value }),
    ),
    aliases: list("files/assets/aliases.json", "key"),
    ...(profile ? { profile } : {}),
    ...(entries["files/assets/profile.webp"]
      ? { profilePicture: webp(entries["files/assets/profile.webp"]) }
      : {}),
  };
}
