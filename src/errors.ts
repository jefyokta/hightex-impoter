export type ImportErrorCode =
  | "invalid_archive"
  | "unsupported_archive"
  | "invalid_path"
  | "duplicate_entry"
  | "manifest_missing"
  | "invalid_manifest"
  | "unsupported_version"
  | "unsupported_format"
  | "invalid_content"
  | "duplicate_chapter"
  | "too_large"
  | "invalid_options";

export class HighTexImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = "HighTexImportError";
  }
  toJSON(): { code: ImportErrorCode; message: string; path?: string } {
    return {
      code: this.code,
      message: this.message,
      ...(this.path ? { path: this.path } : {}),
    };
  }
}
export function fail(
  code: ImportErrorCode,
  message: string,
  path?: string,
): never {
  throw new HighTexImportError(code, message, path);
}
