import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import { base } from './base.js';

/** Lint rules for the Next.js website. */
export const react = [
  ...base,
  reactHooks.configs.flat.recommended,
  { languageOptions: { globals: { ...globals.browser } } },
];

export default react;
