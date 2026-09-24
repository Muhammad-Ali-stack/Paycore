import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';
import storybook from 'eslint-plugin-storybook';

const HEX = '/#[0-9a-fA-F]{3,8}\\b/';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  ...storybook.configs['flat/recommended'],
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error', 'debug'] }],
    },
  },
  {
    // Design-system rule: components use tokens, never raw colours.
    files: ['src/components/**/*.tsx', 'src/features/**/*.tsx', 'src/app/**/*.tsx'],
    ignores: ['src/app/layout.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `Literal[value=${HEX}]`,
          message: 'Use design tokens (Tailwind theme classes or var(--pc-*)) instead of hex colours.',
        },
        { selector: `TemplateElement[value.raw=${HEX}]`, message: 'Use design tokens instead of hex colours.' },
      ],
    },
  },
  {
    // Money must never be parsed into floats in UI code.
    files: ['src/components/**/*.tsx', 'src/features/**/*.tsx', 'src/app/**/*.tsx'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'parseFloat', message: 'Money is integer minor units: use lib/money.ts.' },
      ],
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'storybook-static/**',
    'playwright-report/**',
    'test-results/**',
    'coverage/**',
    'next-env.d.ts',
    'src/lib/api/schema.d.ts',
    'public/sw.js',
  ]),
]);
