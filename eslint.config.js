import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['**/node_modules/', '**/dist/', '**/coverage/'] },
  js.configs.recommended,
  {
    files: ['backend/**/*.js', '*.js', 'frontend/vite.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['frontend/src/**/*.{js,jsx}', 'frontend/tests/**/*.{js,jsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
];
