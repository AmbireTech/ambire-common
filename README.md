# Common ground for the Ambire apps

This package puts together the core business logic behind the Ambire browser extensions and (the future) mobile apps.

## Install

This package is not intended to run standalone.

It’s meant to be used as a dependency by Ambire apps.

You may install it standalone only for development purposes — e.g. to run tests, make changes, or compile it locally:

```bash
npm install
```

## Environment Variables

Create ".env" file in the root directory and fill in all variables, see ".env-sample" for a reference.

## Branching & Git Flow

We follow a lightweight Git branching model:

- **v1** (legacy)

  - `v1` branch (ex `master` branch), now archived as the final state of the v1 codebase. Ambire v1 apps are in maintenance mode, so occasionally small changes may be applied to this branch.
  - `develop` branch - deprecated and deleted; used in the past for v1 development

- **v2** (current)

  - `v2` branch is our active development branch
  - `main` branch - reflects the current production version, all releases are merged here

## Compiling

This package **does not** include compiled output in the repository.

Each Ambire app compiles it individually as needed.

The dist/ folder exists for internal use only. It may contain some compiled files, but it is not kept up to date and not updated on release.

Do not rely on dist/ as a source of compiled code.

Example on how to manually compile a file to the dist/ folder:

```bash
tsc src/libs/portfolio/getOnchainBalances.ts \
  --target es2020 \
  --module commonjs \
  --esModuleInterop true \
  --sourceMap true \
  --resolveJsonModule true \
  --outDir ./dist
```

## Rules

Always commit in ambire-common code that's compatible with web & mobile both 🤞

## Editor Config

Make sure your code editor has plugins that support the following configuration files: `.editorconfig`, `.prettierrc`, `tsconfig.json`, `eslintrc.js`, [`import-sorter.json`](https://github.com/SoominHan/import-sorter).

## Deploy scripts

How to deploy Ambire 7702:

- npx hardhat compile
- npx hardhat run scripts/deploy7702.js --network optimism
- npx hardhat verify --network optimism 0xfe77D030Ac0531f5A62bAe502712b1F1cf976DD9
