const react = require('eslint-plugin-react')
const reactHooks = require('eslint-plugin-react-hooks')
const prettier = require('eslint-plugin-prettier')
const typescriptEslint = require('@typescript-eslint/eslint-plugin')
const typescriptParser = require('@typescript-eslint/parser')
const globals = require('globals')

// Import custom rules
const importPlugin = require('eslint-plugin-import')
const eslintConfigPrettier = require('eslint-config-prettier')
const ambirePlugin = require('./eslint-rules')

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'babel_cache/**',
      'artifacts/**',
      'dist/**',
      'coverage/**',
      'contracts/**'
    ]
  },
  {
    files: ['**/*.js', '**/*.jsx', '**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: typescriptParser,
      parserOptions: {
        projectService: {
          defaultProject: './tsconfig.json'
        },
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
    settings: {
      react: {
        version: 'detect'
      },
      // Prevents eslint-plugin-import from parsing node_modules (e.g. react-native Flow syntax).
      'import/ignore': ['node_modules']
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      prettier,
      '@typescript-eslint': typescriptEslint,
      import: importPlugin,
      ambire: ambirePlugin
    },
    rules: {
      ...typescriptEslint.configs.recommended.rules,
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
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
      '@typescript-eslint/no-explicit-any': 'off',
      semi: ['error', 'never'],
      'import/no-cycle': 'error',
      'import/no-unresolved': 'off' // because typescript already covers this
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
  },
  // disables ESLint formatting rules that conflict with Prettier (must be last)
  eslintConfigPrettier
]
