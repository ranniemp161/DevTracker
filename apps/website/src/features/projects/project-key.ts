import { PROJECT_KEY_MAX_LENGTH } from '@devtrack/validators';

/** A readable starting point; the workspace checks whether the prefix is reserved. */
export function projectKeyFromName(name: string): string {
  if (!name.trim()) return '';
  const words = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .match(/[A-Za-z0-9]+/g);
  if (!words) return 'PRJ';
  const first = words[0]!;
  const prefix =
    words.length === 1
      ? first.slice(0, 5)
      : words.map((word) => (word === word.toUpperCase() ? word : word[0])).join('');
  const key = prefix.toUpperCase();
  return (/^[0-9]/.test(key) || key.length === 1 ? 'P' + key : key).slice(
    0,
    PROJECT_KEY_MAX_LENGTH,
  );
}
