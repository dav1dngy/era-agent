import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '**/node_modules/', '.era/', 'dist/', 'coverage/', 'apps/studio/out/'] },
  js.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  // ERA Studio's web UI runs in a browser.
  {
    files: ['apps/studio/web/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
  },
  // Electron main/preload processes are CommonJS.
  {
    files: ['apps/studio/**/*.cjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
  },
];
