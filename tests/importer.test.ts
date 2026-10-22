import { describe, expect, test } from "bun:test";
import { strToU8, Zip, ZipDeflate, zipSync } from "fflate";
import {
  HighTexImportError,
  parseHighTexV2,
  type ImportErrorCode,
} from "../src/index.js";

const encode = (value: unknown) => strToU8(JSON.stringify(value));
const manifest = {
  schema_version: 2,
  version: 2,
  format: "json",
  document: {
    id: "doc",
    title: { id: "Judul", en: "Title" },
    category: "1",
    keywords: { id: ["id"], en: ["en"] },
  },
};
const base = () => ({
  "manifest.json": encode(manifest),
  "files/chapters/1.json": encode([
    { type: "paragraph", content: [{ type: "text", text: "A  B" }] },
  ]),
});
const archive = (values: Record<string, Uint8Array>) => zipSync(values);
function code(fn: () => unknown, expected: ImportErrorCode) {
  try {
    fn();
    throw new Error("Expected import failure");
  } catch (error) {
    expect(error).toBeInstanceOf(HighTexImportError);
    expect((error as HighTexImportError).code).toBe(expected);
  }
}

describe("HighTex v2 archive validation", () => {
  test("parses complete v2 model, defaults, dates and binary assets without browser APIs", () => {
    const entries = {
      ...base(),
      "files/config.json": encode({
        consentDate: "2026-10-22T00:00:00Z",
        intern: { validity: "2026-01-01" },
      }),
      "files/profile.json": encode({
        name: "Author",
        nim: "123",
        cv: "CV",
        secondAdvisor: { name: "Advisor", nip: "456" },
      }),
      "files/assets/profile.webp": new Uint8Array([1, 2]),
      "files/assets/images/image.webp": new Uint8Array([3, 4]),
      "files/assets/references.json": encode({ ref: "@book{}" }),
      "files/assets/variables.json": encode([
        { name: "place", value: "Jakarta", documentId: "ignored" },
      ]),
      "files/assets/aliases.json": encode([{ key: "key", value: "Alias" }]),
    };
    const parsed = parseHighTexV2(archive(entries));
    expect(parsed.document).toMatchObject({
      id: "doc",
      title: "Judul",
      altTitle: "Title",
      keywords: { indonesian: ["id"], english: ["en"] },
    });
    expect(parsed.chapters[0].id).toBe("1");
    expect(parsed.config.consentDate).toBe("2026-10-22T00:00:00Z");
    expect(parsed.profile).toMatchObject({
      name: "Author",
      advisorName: "",
      secondAdvisor: { name: "Advisor" },
    });
    expect([...parsed.images.image.bytes]).toEqual([3, 4]);
    expect([...parsed.profilePicture!.bytes]).toEqual([1, 2]);
    expect(parsed.variables).toEqual([{ name: "place", value: "Jakarta" }]);
    expect(parsed.references.ref).toBe("@book{}");
    expect(parsed.aliases).toEqual([{ key: "key", value: "Alias" }]);
  });

  test("accepts historical version alias and missing format; normalizes chapters deterministically", () => {
    const entries = {
      "manifest.json": encode({
        version: 2,
        document: { id: "d" },
        profile: { name: "Old" },
      }),
      "files/chapters/10.json": encode({ type: "doc", content: [] }),
      "files/chapters/2.json": encode({ type: "paragraph" }),
      "files/chapters/en.json": encode([]),
      "files/chapters/id.json": encode([]),
    };
    const result = parseHighTexV2(archive(entries));
    expect(result.manifest.schema_version).toBe(2);
    expect(result.manifest.format).toBe("json");
    expect(result.chapters.map((x) => x.id)).toEqual([
      "abstract",
      "abstract-en",
      "2",
      "10",
    ]);
    expect(result.profile?.name).toBe("Old");
    expect(result.config).toEqual({});
    const reverse = Object.fromEntries(Object.entries(entries).reverse());
    expect(parseHighTexV2(archive(reverse))).toEqual(result);
  });

  test.each([
    { schema_version: 1 },
    { version: 1 },
    {},
    { schema_version: 2, version: 3 },
    { schema_version: "2" },
    { schema_version: null, version: 2 },
  ])("rejects non-v2 or conflicting version %p", (value) => {
    code(
      () =>
        parseHighTexV2(
          archive({
            "manifest.json": encode({ ...value, document: { id: "d" } }),
          }),
        ),
      "unsupported_version",
    );
  });

  test("rejects ht content and malformed manifest with serializable errors", () => {
    code(
      () =>
        parseHighTexV2(
          archive({ "manifest.json": encode({ ...manifest, format: "ht" }) }),
        ),
      "unsupported_format",
    );
    code(
      () => parseHighTexV2(archive({ "manifest.json": strToU8("{") })),
      "invalid_manifest",
    );
    code(
      () =>
        parseHighTexV2(
          archive({
            "manifest.json": encode({ ...manifest, document: { id: "" } }),
          }),
        ),
      "invalid_manifest",
    );
    const error = new HighTexImportError("invalid_content", "Broken", "x.json");
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      code: "invalid_content",
      message: "Broken",
      path: "x.json",
    });
  });

  test("supports one wrapping folder but rejects multiple/mixed manifests", () => {
    expect(
      parseHighTexV2(
        archive(
          Object.fromEntries(
            Object.entries(base()).map(([k, v]) => [`wrapper/${k}`, v]),
          ),
        ),
      ).document.id,
    ).toBe("doc");
    code(
      () =>
        parseHighTexV2(
          archive({ ...base(), "other/manifest.json": encode(manifest) }),
        ),
      "invalid_archive",
    );
    code(
      () =>
        parseHighTexV2(
          archive({
            "wrapper/manifest.json": encode(manifest),
            "outside.json": encode({}),
          }),
        ),
      "invalid_archive",
    );
    code(
      () => parseHighTexV2(archive({ "a/b/manifest.json": encode(manifest) })),
      "invalid_archive",
    );
    code(
      () => parseHighTexV2(archive({ "other.json": encode({}) })),
      "manifest_missing",
    );
  });

  test.each([
    "../escape.json",
    "/absolute.json",
    "a\\b.json",
    "a/./b.json",
    "C:/x.json",
    "a//b.json",
  ])("rejects unsafe path %s", (path) => {
    code(
      () => parseHighTexV2(archive({ ...base(), [path]: encode({}) })),
      "invalid_path",
    );
  });

  test("rejects normalized chapter collisions and malformed chapter nodes", () => {
    code(
      () =>
        parseHighTexV2(
          archive({
            ...base(),
            "files/chapters/id.json": encode([]),
            "files/chapters/abstract.json": encode([]),
          }),
        ),
      "duplicate_chapter",
    );
    for (const content of [
      null,
      [1],
      [{ type: "" }],
      [{ type: "text", text: 5 }],
      [{ type: "paragraph", content: {} }],
      [{ type: "text", marks: [{ type: "bold", attrs: [] }] }],
    ])
      code(
        () =>
          parseHighTexV2(
            archive({ ...base(), "files/chapters/1.json": encode(content) }),
          ),
        "invalid_content",
      );
  });

  test("custom nodes/marks survive by default and explicit allowlists are enforced", () => {
    const entries = {
      ...base(),
      "files/chapters/1.json": encode([
        { type: "custom", attrs: { x: 1 }, marks: [{ type: "customMark" }] },
      ]),
    };
    expect(parseHighTexV2(archive(entries)).chapters[0].content[0].type).toBe(
      "custom",
    );
    code(
      () => parseHighTexV2(archive(entries), { allowedNodes: ["paragraph"] }),
      "invalid_content",
    );
    code(
      () => parseHighTexV2(archive(entries), { allowedMarks: ["bold"] }),
      "invalid_content",
    );
  });

  test("validates doc wrapper metadata before unwrapping its children", () => {
    code(
      () =>
        parseHighTexV2(
          archive({
            ...base(),
            "files/chapters/1.json": encode({
              type: "doc",
              attrs: [],
              content: [],
            }),
          }),
        ),
      "invalid_content",
    );
    code(
      () =>
        parseHighTexV2(
          archive({
            ...base(),
            "files/chapters/1.json": encode({ type: "doc", content: [] }),
          }),
          { allowedNodes: ["paragraph"] },
        ),
      "invalid_content",
    );
  });

  test("optional entries may be absent but present corrupt entries never silently pass", () => {
    expect(parseHighTexV2(archive(base())).variables).toEqual([]);
    for (const [path, value] of [
      ["files/assets/variables.json", [{ name: "x", value: 1 }]],
      [
        "files/assets/aliases.json",
        [
          { key: "x", value: "a" },
          { key: "x", value: "b" },
        ],
      ],
      ["files/assets/references.json", { ref: 5 }],
      ["files/profile.json", { name: 1 }],
      ["files/config.json", { consentDate: "invalid" }],
    ] as const)
      code(
        () => parseHighTexV2(archive({ ...base(), [path]: encode(value) })),
        "invalid_content",
      );
  });

  test("enforces archive/entry/total/count/JSON limits and validates options", () => {
    const bytes = archive(base());
    for (const options of [
      { maxArchiveBytes: 1 },
      { maxEntryBytes: 1 },
      { maxUncompressedBytes: 1 },
      { maxEntries: 1 },
      { maxJsonDepth: 1 },
      { maxJsonValues: 1 },
    ])
      code(() => parseHighTexV2(bytes, options), "too_large");
    for (const value of [0, -1, NaN, Infinity, 1.5])
      code(
        () => parseHighTexV2(bytes, { maxEntryBytes: value }),
        "invalid_options",
      );
  });

  test("rejects truncation and checksum corruption", () => {
    const bytes = archive(base());
    code(
      () => parseHighTexV2(bytes.slice(0, bytes.length - 1)),
      "invalid_archive",
    );
    const stored = zipSync(base(), { level: 0 });
    const view = new DataView(stored.buffer);
    stored[30 + view.getUint16(26, true) + view.getUint16(28, true)] ^= 1;
    code(() => parseHighTexV2(stored), "invalid_archive");
    code(() => parseHighTexV2(new Uint8Array([1, 2])), "invalid_archive");
  });

  test("reads stored entries and streaming ZIP entries with data descriptors", () => {
    expect(parseHighTexV2(zipSync(base(), { level: 0 })).document.id).toBe(
      "doc",
    );
    const chunks: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => {
      if (error) throw error;
      chunks.push(chunk);
    });
    for (const [name, bytes] of Object.entries(base())) {
      const entry = new ZipDeflate(name);
      zip.add(entry);
      entry.push(bytes, true);
    }
    zip.end();
    const bytes = new Uint8Array(
      chunks.reduce((total, chunk) => total + chunk.length, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    expect(parseHighTexV2(bytes).document.id).toBe("doc");
  });

  test("detects duplicate central paths and local/central name mismatch", () => {
    const bytes = archive({
      ...base(),
      "aaa.json": encode({}),
      "bbb.json": encode({}),
    });
    // Same-length names patched in both local and central records.
    const patched = bytes.slice();
    const from = strToU8("bbb.json"),
      to = strToU8("aaa.json");
    for (let i = 0; i <= patched.length - from.length; i++)
      if (from.every((byte, j) => patched[i + j] === byte)) patched.set(to, i);
    code(() => parseHighTexV2(patched), "duplicate_entry");
    const mismatch = bytes.slice();
    mismatch[30] ^= 1;
    code(() => parseHighTexV2(mismatch), "invalid_archive");
  });

  test("bounded inflation rejects a forged small declared size", () => {
    const bytes = archive({
      "manifest.json": encode(manifest),
      padding: strToU8("x".repeat(1024 * 1024)),
    });
    const view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length - 46; i++)
      if (view.getUint32(i, true) === 0x02014b50) {
        const nameLength = view.getUint16(i + 28, true);
        if (
          new TextDecoder().decode(
            bytes.subarray(i + 46, i + 46 + nameLength),
          ) === "padding"
        ) {
          view.setUint32(i + 24, 1, true);
          const local = view.getUint32(i + 42, true);
          view.setUint32(local + 22, 1, true);
          break;
        }
      }
    code(() => parseHighTexV2(bytes), "too_large");
  });

  test("prototype-like asset/reference IDs do not mutate object prototypes", () => {
    const entries = {
      ...base(),
      "files/assets/images/__proto__.webp": new Uint8Array([1]),
      "files/assets/references.json": strToU8('{"__proto__":"bib"}'),
    };
    const result = parseHighTexV2(archive(entries));
    expect(result.images["__proto__"].mime).toBe("image/webp");
    expect(result.references["__proto__"]).toBe("bib");
    expect(Object.getPrototypeOf(result.images)).toBeNull();
  });
});
