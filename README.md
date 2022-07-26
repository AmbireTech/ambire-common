# Common ground for the Ambire apps

This package puts together the core business logic behind Ambire web and mobile apps.

## Install

```bash
yarn install
```

## Workflow

1. When a change is needed, submit a PR against the `develop` branch (or against the `main` branch, in case it's a hotfix).

2. When a new version for ambire-common is needed, create a new git tag, issue a new [release](https://github.com/AmbireTech/ambire-common/releases) and describe what has changed. Follow semantic versioning when choosing a tag name.

3. When releasing a new version of the ambire web or the mobile apps, always create a new tag in the `ambire-common` repo, like: [tag v0.6.0](https://github.com/AmbireTech/ambire-common/releases/tag/v0.6.0), if needed. Ideally, any release of the web or mobile app should be accociated with a specific ambire-common tag.

## Rules

Always commit in ambire-common code that's compatible with web & mobile both 🤞

## Update contract/token info (generates `humanizerInfo.json`)

```
yarn generate:contractInfo
```

## Editor Config

Make sure your code editor has plugins that support the following configuration files: `.editorconfig`, `.prettierrc`, `tsconfig.json`, `eslintrc.js`, [`import-sorter.json`](https://github.com/SoominHan/import-sorter).
