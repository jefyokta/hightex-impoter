import { fail, HighTexImportError } from "./errors.js";
import { object, string, stringList } from "./validation.js";
import { readProfile } from "./profile.js";
import type { ManifestV2 } from "./types.js";

export function readManifest(value: unknown): ManifestV2 {
  try {
    const raw = object(value, "manifest.json");
    if (
      (raw.schema_version !== undefined && raw.schema_version !== 2) ||
      (raw.version !== undefined && raw.version !== 2) ||
      (raw.schema_version !== 2 && raw.version !== 2)
    )
      fail(
        "unsupported_version",
        "Only HighTex v2 is supported",
        "manifest.json",
      );
    if (raw.format !== undefined && raw.format !== "json")
      fail(
        "unsupported_format",
        "Only JSON chapter content is supported",
        "manifest.json.format",
      );
    const doc = object(raw.document, "manifest.json.document");
    const id = string(doc.id, "manifest.json.document.id");
    if (!id.trim())
      fail(
        "invalid_manifest",
        "Document ID must not be empty",
        "manifest.json.document.id",
      );
    const manifest: ManifestV2 = {
      schema_version: 2,
      format: "json",
      document: { id },
    };
    if (raw.version === 2) manifest.version = 2;
    if (doc.category !== undefined)
      manifest.document.category = string(
        doc.category,
        "manifest.json.document.category",
      );
    if (doc.title !== undefined) {
      const title = object(doc.title, "manifest.json.document.title");
      manifest.document.title = {};
      for (const language of ["id", "en"] as const)
        if (title[language] !== undefined)
          manifest.document.title[language] = string(
            title[language],
            `manifest.json.document.title.${language}`,
          );
    }
    if (doc.keywords !== undefined) {
      const keywords = object(doc.keywords, "manifest.json.document.keywords");
      manifest.document.keywords = {};
      for (const language of ["id", "en"] as const)
        if (keywords[language] !== undefined)
          manifest.document.keywords[language] = stringList(
            keywords[language],
            `manifest.json.document.keywords.${language}`,
          );
    }
    const profile = readProfile(raw.profile, "manifest.json.profile");
    if (profile) manifest.profile = profile;
    return manifest;
  } catch (error) {
    if (error instanceof HighTexImportError && error.code === "invalid_content")
      fail("invalid_manifest", error.message, error.path);
    throw error;
  }
}
