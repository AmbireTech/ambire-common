module.exports = {
  env: {
    browser: false,
    node: true,
    es2021: true
  },
  extends: ['plugin:react/recommended', 'airbnb', 'prettier', 'airbnb-typescript'],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: './tsconfig.json',
    ecmaFeatures: {
      jsx: true
    },
    ecmaVersion: 13,
    sourceType: 'module'
  },
  plugins: ['react', 'react-hooks', 'prettier', '@typescript-eslint'],
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
    'react-hooks/exhaustive-deps': 'warn'
  }
}
