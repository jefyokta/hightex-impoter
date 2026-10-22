# @hightex/importer

Parse and validate **HighTex v2 archives containing JSON chapters** for server validation pipelines. The library accepts bytes and returns a document model. It does not write to a database, open an editor, read a user's profile, or create Blob objects.

The package provides ESM JavaScript and TypeScript declarations for Node.js 20+, Bun, and browser bundlers. Its only runtime dependency is `fflate`. The manifest sets `publishConfig.access` to `public` for publishing the scoped package to npm.

## Usage

```js
import { parseHighTexV2, HighTexImportError } from "@hightex/importer";

try {
  const model = parseHighTexV2(bytes); // Uint8Array, Buffer, or ArrayBuffer
  // Pass this model directly to @hightex/scanner's createScanContext(model).
} catch (error) {
  if (error instanceof HighTexImportError) {
    console.log(JSON.stringify(error)); // { code, message, path? }
  } else throw error;
}
```

In a browser, read a file with `new Uint8Array(await file.arrayBuffer())`. A Node.js Buffer from an uploaded or local file is already a Uint8Array. The host should enforce upload limits before loading the entire file into memory.

## Archive format

- The manifest must declare `schema_version: 2` or the historical alias `version: 2`. If both fields exist, both must equal `2`. Missing versions, v1, and conflicting declarations are rejected.
- `format` must be `json`; a missing format defaults to JSON. The unimplemented `ht` format is rejected.
- `manifest.document.id` must be a nonempty string. Optional titles, keywords, category, and profile fields are validated when present.
- `manifest.json` must be at the root or inside one consistent wrapping folder containing all archive files. Multiple manifests and ambiguous paths are rejected.
- Chapters live directly in `files/chapters/<id>.json`. Content can be a node array, a `doc` wrapper, or a single node. Chapter IDs `id` and `en` normalize to `abstract` and `abstract-en`; collisions after normalization are rejected.
- Chapter order is deterministic: abstract, abstract-en, foreword, presentation, numeric chapters in natural order, other chapters in lexical order, reference, attachment. The host can reorder chapters using its category metadata.
- References are a string dictionary in `files/assets/references.json`; a historical empty array is also accepted. Variables and aliases are arrays of string key/value records with unique keys. Storage-only fields such as `documentId` are not forwarded.
- Configuration is a JSON object in `files/config.json`. Common date fields and `intern.validity` must be valid date strings or null when present. Dates remain strings; storage conversion belongs to the host.
- Profiles come from `files/profile.json`, falling back to `manifest.profile`. Identity and advisor fields are validated without reading account defaults.
- Images use `files/assets/images/<id>.webp`; a profile picture uses `files/assets/profile.webp`. Both are returned as `{ bytes: Uint8Array, mime: "image/webp" }`. The parser validates the container and structure; it does not decode media or prove that bytes with a WebP extension can render. Add media validation in the host if needed.
- Missing optional entries use defaults. Corrupt entries that are present cause validation errors. Extra files outside recognized paths are not executed or included in the model.

The returned model contains `importerVersion`, `manifest`, `document`, `chapters`, `config`, `references`, `images`, `variables`, `aliases`, and optional profile/profile-picture fields. Binary assets remain bytes. Use the scanner's report for JSON API responses rather than serializing the entire model and its assets.

Custom nodes and marks are preserved when structurally valid. Restrict extensions explicitly when the server requires an allowlist:

```js
const model = parseHighTexV2(bytes, {
  allowedNodes: ["doc", "paragraph", "text", "hardBreak"],
  allowedMarks: ["bold", "italic"],
  maxArchiveBytes: 16 * 1024 * 1024,
});
```

## Resource limits and errors

`DEFAULT_IMPORT_LIMITS` provides these defaults:

| Option                 | Default                        |
| ---------------------- | ------------------------------ |
| `maxArchiveBytes`      | 64 MiB                         |
| `maxUncompressedBytes` | 128 MiB                        |
| `maxEntryBytes`        | 32 MiB                         |
| `maxEntries`           | 2,000, including directories   |
| `maxJsonDepth`         | 100                            |
| `maxJsonValues`        | 200,000 across all parsed JSON |

Every limit can be overridden with a positive integer. The parser inspects the complete central directory before decompression, counts inflated output incrementally, checks actual lengths and CRC32, and rejects inconsistent local/central headers. It rejects traversal, absolute paths, backslashes, NUL/control characters, duplicate paths, overlapping entries, and unsupported ZIP variants.

ZIP32 stored/deflate entries and data descriptors are supported. ZIP64, multi-disk archives, encryption, and other compression methods are rejected. Entry names must be valid UTF-8. Parsing is synchronous; the host controls concurrency and hard timeouts.

Public error codes:

`invalid_archive`, `unsupported_archive`, `invalid_path`, `duplicate_entry`, `manifest_missing`, `invalid_manifest`, `unsupported_version`, `unsupported_format`, `invalid_content`, `duplicate_chapter`, `too_large`, `invalid_options`.

Errors provide `code`, `message`, an optional `path`, and `toJSON()`. The host handles localization, HTTP status mapping, and acceptance decisions. The parser does not validate academic requirements, server category relationships, every cross-reference, or archive authenticity.

## Development

Install Node.js 20+, npm, and Bun, then run:

```sh
npm install
npm run build
npm test
npm run typecheck
```

The package is independent of the desktop repository. Public types use a local structural JSON contract; no desktop aliases or editor runtime dependencies are required.

## Prepare a release version

Run inside this package:

```sh
npm run release:version -- patch
npm run release:version -- minor
npm run release:version -- major
npm run release:version -- 1.0.0
npm run release:version -- preminor --preid=beta
```

The command runs typecheck and tests first, bumps `package.json` and any existing npm lockfile, synchronizes `IMPORTER_VERSION`, then rebuilds `dist`. It uses npm's `preversion` and `version` hooks. Keep lifecycle scripts enabled. Bun, pnpm, and Yarn lockfiles require a separate update with their own package manager.

The command prepares files locally without publishing, creating a Git commit/tag, or pushing. If a post-bump build fails, fix the error and run `npm run build` before packing. The schema version remains `2`; changing the library version does not change the archive format. See [npm's version lifecycle](https://docs.npmjs.com/cli/v11/commands/npm-version/).

Inspect and package the build:

```sh
npm pack --dry-run
npm pack
```

The `prepack` hook builds and synchronizes version metadata. The `files` allowlist includes `dist` and `README.md`; `.npmignore` lists source, tests, release tooling, configuration, lockfiles, secrets, and other development artifacts. The resulting tarball contains compiled JavaScript, declarations, the README, and package metadata. See [npm's package file rules](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#files).

To publish the prepared version, run `npm publish`. The manifest's `publishConfig.access: "public"` ensures the scoped package is published publicly.
