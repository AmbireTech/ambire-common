# Common ground for the Ambire apps

This package puts together the core business logic behind Ambire web and mobile apps.

## Install

```bash
yarn install
```

## Workflow

1. When a change is needed, submit a PR against the `develop` branch (or against the `main` branch, in case it's a hotfix).

2. When a new version for ambire-common is needed, create a new git tag, issue a new [release](https://github.com/AmbireTech/ambire-common/releases) and describe what has changed. Follow semantic versioning when choosing a tag name.

3. When releasing a new version of the ambire web or the mobile apps, always create a new tag in the `ambire-common` repo, like: [tag v0.6.0](https://github.com/AmbireTech/ambire-common/releases/tag/v0.6.0), if needed. Ideally, any release of the web or mobile app should be associated with a specific ambire-common tag.

## Rules

Always commit in ambire-common code that's compatible with web & mobile both 🤞

## Tips

Tip during development: After cloning the web or the mobile app and doing `npm install` (or `yarn install`), delete the `node_modules/ambire-common` directory and git clone the ambire-common (this) repository into `node_modules/ambire-common` instead. This way you can modify and commit changes to ambire-common and they will be instantly visible on the web or the mobile app during development.

Tip during development: When updating the ambire-common version in the web app `package.json`, do not manually change your `package.json` and run `npm install`. Instead, execute `npm install "github:AmbireTech/ambire-common#v0.11.0"`. Otherwise, for some reason, package-lock file don't update accordingly and they persist refs to the previous ambire-common version. The issue either comes from npm instelf, or for something really specific in web's package-lock file.

Tip for hotfixes: In case you immediately need the change on PROD, you can simply (temporarily) ref in app's `package.json` instead a tag (`"ambire-common": "github:AmbireTech/ambire-common#v0.11.2"`) a specific commit SHA (`"ambire-common": "github:AmbireTech/ambire-common#2e8639e004044bda3fe7efa3290672d63bfe5f8a"`).

## Update contract/token info (generates `humanizerInfo.json`)

```
yarn generate:contractInfo
```

## Editor Config

Make sure your code editor has plugins that support the following configuration files: `.editorconfig`, `.prettierrc`, `tsconfig.json`, `eslintrc.js`, [`import-sorter.json`](https://github.com/SoominHan/import-sorter).
