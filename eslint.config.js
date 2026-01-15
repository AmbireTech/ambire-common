const react = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')
const prettier = require('eslint-plugin-prettier')
const typescriptEslint = require('@typescript-eslint/eslint-plugin')
const typescriptParser = require('@typescript-eslint/parser')
const globals = require('globals')

// Import custom rules
const ambirePlugin = require('./eslint-rules')

module.exports = [
  {
    files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        project: './tsconfig.json',
        ecmaFeatures: {
          jsx: true
        },
        ecmaVersion: 'latest',
        sourceType: 'module'
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2021
      }
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      prettier,
      '@typescript-eslint': typescriptEslint,
      ambire: ambirePlugin
    },
    rules: {
      'prettier/prettier': [
        'error',
        {
          useTabs: false
        }
      ],
      'func-names': 0,
      'prefer-destructuring': 0,
      '@typescript-eslint/semi': 'off',
      'react/style-prop-object': 'off',
      'react/function-component-definition': 'off',
      'arrow-body-style': 'off',
      'import/prefer-default-export': 'off',
      '@typescript-eslint/comma-dangle': 'off',
      'consistent-return': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react/require-default-props': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-extra-semi': 'off',
      'no-plusplus': 'off',
      '@typescript-eslint/indent': 'off',
      'react/no-unstable-nested-components': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      'react/react-in-jsx-scope': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      semi: ['error', 'never']
    }
  },
  // Custom rules for controllers only
  // Done to avoid false positives
  // and reduce performance impact
  {
    files: ['src/controllers/**/*.ts', 'src/ambire-common/src/controllers/**/*.ts'],
    plugins: {
      ambire: ambirePlugin
    },
    rules: {
      'ambire/no-emit-update-in-on-update': 'error'
    }
  }
]
