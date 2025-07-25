# Common ground for the Ambire apps

This package puts together the core business logic behind Ambire web and (the future) mobile apps.

## Install

```bash
npm install
```

## Rules

Always commit in ambire-common code that's compatible with web & mobile both 🤞

## Compiling

How to compile files to the dist folder: tsc src/libs/portfolio/getOnchainBalances.ts -t es2020 -m commonjs --esModuleInterop true --sourceMap true --resolveJsonModule true --outDir ./dist

## Editor Config

Make sure your code editor has plugins that support the following configuration files: `.editorconfig`, `.prettierrc`, `tsconfig.json`, `eslintrc.js`, [`import-sorter.json`](https://github.com/SoominHan/import-sorter).

## Deploy scripts

How to deploy Ambire 7702:

- npx hardhat compile
- npx hardhat run scripts/deploy7702.js --network optimism
- npx hardhat verify --network optimism 0xfe77D030Ac0531f5A62bAe502712b1F1cf976DD9
