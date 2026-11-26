import {
  MAX_REQUEST_FILES,
  MAX_REQUEST_IMAGE_BYTES,
  MAX_REQUEST_MARKDOWN_BYTES,
  REQUEST_FILE_TYPES,
} from '@devtrack/validators';

/** A file chosen on the public request form (decision record 0022). */
export interface PickedFile {
  key: string;
  file: File;
  contentType: (typeof REQUEST_FILE_TYPES)[number];
}

/** What the file input accepts. */
export const REQUEST_FILE_ACCEPT = [...REQUEST_FILE_TYPES, '.md', '.markdown'].join(',');

const TYPE_ERROR = 'attach PNG, JPEG, GIF or WebP images, or Markdown (.md) files.';
let nextKey = 0;

/** Browsers rarely know `.md`; the extension decides. */
export function fileContentType(file: File): string {
  return /\.(md|markdown)$/i.test(file.name) ? 'text/markdown' : file.type;
}

const isAllowed = (type: string): type is PickedFile['contentType'] =>
  (REQUEST_FILE_TYPES as readonly string[]).includes(type);

/**
 * Adds files to the picked list, refusing other types, files over the size limits and
 * anything past five files, with one message per refused file. Pasted screenshots (named
 * `image.png` by browsers) get readable numbered names.
 */
export function addFiles(
  current: readonly PickedFile[],
  incoming: readonly File[],
  { pasted = false }: { pasted?: boolean } = {},
): { files: PickedFile[]; errors: string[] } {
  const files = [...current];
  const errors: string[] = [];
  for (const original of incoming) {
    const contentType = fileContentType(original);
    if (!isAllowed(contentType)) {
      errors.push(`${original.name}: ${TYPE_ERROR}`);
      continue;
    }
    const markdown = contentType === 'text/markdown';
    if (original.size > (markdown ? MAX_REQUEST_MARKDOWN_BYTES : MAX_REQUEST_IMAGE_BYTES)) {
      errors.push(
        markdown
          ? `${original.name}: Markdown files can be at most 256 KB.`
          : `${original.name}: images can be at most 10 MB.`,
      );
      continue;
    }
    if (files.length >= MAX_REQUEST_FILES) {
      errors.push(`${original.name}: you can attach at most ${MAX_REQUEST_FILES} files.`);
      continue;
    }
    let file = original;
    if (pasted) {
      const shots = files.filter((f) => f.file.name.startsWith('screenshot-')).length;
      const ext = contentType.split('/')[1] === 'jpeg' ? 'jpg' : contentType.split('/')[1];
      file = new File([original], `screenshot-${shots + 1}.${ext}`, { type: contentType });
    }
    files.push({ key: `file-${++nextKey}`, file, contentType });
  }
  return { files, errors };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
