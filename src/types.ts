export interface DocumentNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: {
    type: string;
    attrs?: Record<string, unknown>;
    [key: string]: unknown;
  }[];
  content?: DocumentNode[];
  [key: string]: unknown;
}
export interface AuthorProfile {
  name: string;
  nim: string;
  advisorName: string;
  advisorNip: string;
  cv: string;
  secondAdvisor?: { name: string; nip: string };
}
export interface ManifestV2 {
  schema_version: 2;
  version?: 2;
  format: "json";
  document: {
    id: string;
    title?: { id?: string; en?: string };
    keywords?: { id?: string[]; en?: string[] };
    category?: string;
  };
  profile?: AuthorProfile;
}
export interface BinaryAsset {
  bytes: Uint8Array;
  mime: "image/webp";
}
export interface ImportedHighTexV2 {
  importerVersion: string;
  manifest: ManifestV2;
  document: {
    id: string;
    title: string;
    altTitle: string;
    category?: string;
    keywords: { indonesian: string[]; english: string[] };
  };
  /** Stable natural order by normalized ID; host may reorder with category metadata. */
  chapters: { id: string; content: DocumentNode[] }[];
  config: Record<string, unknown>;
  references: Record<string, string>;
  images: Record<string, BinaryAsset>;
  variables: { name: string; value: string }[];
  aliases: { key: string; value: string }[];
  profile?: AuthorProfile;
  profilePicture?: BinaryAsset;
}
export interface ImportValidationOptions {
  maxArchiveBytes?: number;
  maxUncompressedBytes?: number;
  maxEntryBytes?: number;
  maxEntries?: number;
  maxJsonDepth?: number;
  maxJsonValues?: number;
  allowedNodes?: readonly string[];
  allowedMarks?: readonly string[];
}
export interface ImportLimits {
  maxArchiveBytes: number;
  maxUncompressedBytes: number;
  maxEntryBytes: number;
  maxEntries: number;
  maxJsonDepth: number;
  maxJsonValues: number;
}
