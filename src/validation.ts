import { fail } from "./errors.js";
import type {
  DocumentNode,
  ImportLimits,
  ImportValidationOptions,
} from "./types.js";

export const DEFAULT_IMPORT_LIMITS: Readonly<ImportLimits> = Object.freeze({
  maxArchiveBytes: 64 * 1024 * 1024,
  maxUncompressedBytes: 128 * 1024 * 1024,
  maxEntryBytes: 32 * 1024 * 1024,
  maxEntries: 2000,
  maxJsonDepth: 100,
  maxJsonValues: 200000,
});
export function getLimits(options: ImportValidationOptions): ImportLimits {
  const limits = { ...DEFAULT_IMPORT_LIMITS };
  for (const key of Object.keys(limits) as (keyof ImportLimits)[]) {
    const value = options[key];
    if (value === undefined) continue;
    if (!Number.isSafeInteger(value) || value <= 0)
      fail("invalid_options", `${key} must be a positive safe integer`);
    limits[key] = value;
  }
  for (const key of ["allowedNodes", "allowedMarks"] as const)
    if (
      options[key] !== undefined &&
      (!Array.isArray(options[key]) ||
        options[key]!.some((x) => typeof x !== "string" || !x))
    )
      fail("invalid_options", `${key} must contain nonempty strings`);
  return limits;
}
export function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("invalid_content", "Expected an object", path);
  return value as Record<string, unknown>;
}
export function string(value: unknown, path: string): string {
  if (typeof value !== "string")
    fail("invalid_content", "Expected a string", path);
  return value;
}
export function stringList(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) fail("invalid_content", "Expected an array", path);
  return value.map((item, i) => string(item, `${path}[${i}]`));
}
export function createJsonReader(
  entries: Record<string, Uint8Array>,
  limits: ImportLimits,
) {
  let values = 0;
  return (path: string): unknown => {
    let value: unknown;
    try {
      value = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(entries[path]),
      );
    } catch {
      fail("invalid_content", "Invalid UTF-8 or JSON", path);
    }
    const stack = [{ value, depth: 0 }];
    while (stack.length) {
      const item = stack.pop()!;
      if (++values > limits.maxJsonValues || item.depth > limits.maxJsonDepth)
        fail("too_large", "JSON value count or depth limit exceeded", path);
      if (typeof item.value === "number" && !Number.isFinite(item.value))
        fail("invalid_content", "JSON numbers must be finite", path);
      if (item.value && typeof item.value === "object")
        for (const child of Object.values(item.value))
          stack.push({ value: child, depth: item.depth + 1 });
    }
    return value;
  };
}

export function chapterContent(
  value: unknown,
  path: string,
  options: ImportValidationOptions,
): DocumentNode[] {
  const nodeTypes = options.allowedNodes && new Set(options.allowedNodes);
  const markTypes = options.allowedMarks && new Set(options.allowedMarks);
  const wrapper = !Array.isArray(value) && object(value, path).type === "doc";
  const nodes = Array.isArray(value)
    ? value
    : object(value, path).type === "doc"
      ? (object(value, path).content ?? [])
      : [value];
  if (!Array.isArray(nodes))
    fail("invalid_content", "Invalid chapter content", path);
  const stack = wrapper
    ? [{ node: value, path }]
    : nodes.map((node, i) => ({ node, path: `${path}[${i}]` }));
  while (stack.length) {
    const item = stack.pop()!;
    const node = object(item.node, item.path);
    if (
      typeof node.type !== "string" ||
      !node.type ||
      (nodeTypes && !nodeTypes.has(node.type))
    )
      fail("invalid_content", "Invalid or disallowed node type", item.path);
    if (node.text !== undefined) string(node.text, `${item.path}.text`);
    if (node.attrs !== undefined) object(node.attrs, `${item.path}.attrs`);
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks))
        fail("invalid_content", "Expected marks array", item.path);
      for (const value of node.marks) {
        const mark = object(value, `${item.path}.marks`);
        if (
          typeof mark.type !== "string" ||
          !mark.type ||
          (markTypes && !markTypes.has(mark.type))
        )
          fail("invalid_content", "Invalid or disallowed mark type", item.path);
        if (mark.attrs !== undefined)
          object(mark.attrs, `${item.path}.marks.attrs`);
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content))
        fail("invalid_content", "Expected node content array", item.path);
      node.content.forEach((child, i) =>
        stack.push({ node: child, path: `${item.path}.content[${i}]` }),
      );
    }
  }
  // All node/mark fields above are checked before exposing the structural type.
  return nodes as DocumentNode[];
}
