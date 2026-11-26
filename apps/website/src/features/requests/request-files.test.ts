import { describe, expect, it } from 'vitest';
import { addFiles, fileContentType, formatBytes, type PickedFile } from './request-files';

const file = (name: string, type: string, size: number) =>
  new File([new Uint8Array(size)], name, { type });

describe('fileContentType', () => {
  it('treats .md and .markdown as Markdown whatever the browser says', () => {
    expect(fileContentType(file('notes.md', '', 1))).toBe('text/markdown');
    expect(fileContentType(file('SPEC.MARKDOWN', 'application/octet-stream', 1))).toBe(
      'text/markdown',
    );
    expect(fileContentType(file('shot.png', 'image/png', 1))).toBe('image/png');
  });
});

describe('addFiles', () => {
  it('adds accepted files and explains each refused one', () => {
    const { files, errors } = addFiles(
      [],
      [
        file('shot.png', 'image/png', 100),
        file('clip.mp4', 'video/mp4', 100),
        file('logo.svg', 'image/svg+xml', 100),
        file('huge.jpg', 'image/jpeg', 10 * 1024 * 1024 + 1),
        file('spec.md', '', 256 * 1024 + 1),
        file('steps.md', '', 300),
      ],
    );
    expect(files.map((f) => [f.file.name, f.contentType])).toEqual([
      ['shot.png', 'image/png'],
      ['steps.md', 'text/markdown'],
    ]);
    expect(errors).toEqual([
      'clip.mp4: attach PNG, JPEG, GIF or WebP images, or Markdown (.md) files.',
      'logo.svg: attach PNG, JPEG, GIF or WebP images, or Markdown (.md) files.',
      'huge.jpg: images can be at most 10 MB.',
      'spec.md: Markdown files can be at most 256 KB.',
    ]);
  });

  it('stops at five files', () => {
    const start: PickedFile[] = addFiles(
      [],
      [1, 2, 3, 4].map((i) => file(`${i}.png`, 'image/png', 10)),
    ).files;
    const { files, errors } = addFiles(start, [
      file('5.png', 'image/png', 10),
      file('6.png', 'image/png', 10),
    ]);
    expect(files.map((f) => f.file.name)).toEqual(['1.png', '2.png', '3.png', '4.png', '5.png']);
    expect(errors).toEqual(['6.png: you can attach at most 5 files.']);
  });

  it('names pasted screenshots, which arrive without a useful name', () => {
    const { files } = addFiles([], [file('image.png', 'image/png', 10)], { pasted: true });
    expect(files[0]!.file.name).toBe('screenshot-1.png');
    const more = addFiles(files, [file('image.png', 'image/png', 10)], { pasted: true });
    expect(more.files[1]!.file.name).toBe('screenshot-2.png');
  });

  it('gives every file its own key', () => {
    const { files } = addFiles([], [file('a.png', 'image/png', 1), file('a.png', 'image/png', 1)]);
    expect(new Set(files.map((f) => f.key)).size).toBe(2);
  });
});

describe('formatBytes', () => {
  it('shows short sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB');
  });
});
