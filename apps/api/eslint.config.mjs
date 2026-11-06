import { base } from '@devtrack/eslint-config/base';

export default [...base, { ignores: ['dist/**', 'eslint.config.mjs', 'server.mjs', 'scripts/**'] }];
