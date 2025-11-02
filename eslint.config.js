// https://docs.expo.dev/guides/using-eslint/
const path = require('path');
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const { allExtensions } = require('eslint-config-expo/flat/utils/extensions.js');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    settings: {
      'import/extensions': allExtensions,
      'import/resolver': {
        typescript: {
          project: ['./tsconfig.eslint.json'],
          alwaysTryTypes: true,
        },
        node: {
          extensions: allExtensions,
          moduleDirectory: ['node_modules', path.resolve(__dirname, '.')],
        },
      },
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: path.resolve(__dirname, 'tsconfig.eslint.json'),
        tsconfigRootDir: __dirname,
      },
    },
  },
]);
