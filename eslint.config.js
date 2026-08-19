// ESLint flat config.
//
// Three environments in one repo: browser React under `src/`, Node under
// `server/`, and Node config/test files at the root. `react-hooks` matters most
// here — the tools run long polling loops inside effects, which is exactly where
// a stale dependency array causes a real bug.

import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  js.configs.recommended,

  // Browser code: the tools and the shared component library.
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,

      // The two classic hook rules, enabled by name rather than by spreading
      // `reactHooks.configs.recommended`. That preset now also carries the
      // React Compiler rules, which this codebase is not written for: it
      // hydrates state from localStorage inside mount effects (restoring
      // in-flight Replicate jobs, re-reading the API keys when the modal
      // opens), which `set-state-in-effect` flags but which is the intended
      // use of an effect — synchronising with an external system. Adopting
      // that preset would mean either suppressing it at each site or
      // restructuring working features. Revisit if the compiler is adopted.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // The tools use the automatic JSX runtime, so React need not be in scope.
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // Apostrophes in ordinary UI copy are fine; escaping them costs more in
      // readability than the rule catches.
      'react/no-unescaped-entities': 'off',
    },
  },

  // The Node server.
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // Config and tests.
  {
    files: ['*.js', 'test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.vitest },
    },
  },

  // Keep formatting decisions with Prettier, not ESLint. Must come last.
  prettier,
];
