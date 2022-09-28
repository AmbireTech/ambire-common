# Common ground for the Ambire apps

This package puts together the core business logic behind Ambire web and mobile apps.

## Install

```bash
yarn install
```

## Workflow

1. Release cycle: every Monday.

1. When a change is needed, if you need it fast (hot), PR against `main`

1. When a change is needed, if you can wait until Monday - PR against `develop`

1. If needed, introduce a release branch (example: `release/0.16.0`). Merge multiple changes needed for the web or mobile apps QA in there.

1. When a new version for ambire-common is needed, create a new git tag, issue a new [release](https://github.com/AmbireTech/ambire-common/releases) and describe what has changed. Follow semantic versioning when choosing a tag name.

## Rules

Always commit in ambire-common code that's compatible with web & mobile both 🤞

## Tips

Tip during development: After cloning the web or the mobile app and doing `npm install` (or `yarn install`), delete the `node_modules/ambire-common` directory and git clone the ambire-common (this) repository into `node_modules/ambire-common` instead. This way you can modify and commit changes to ambire-common and they will be instantly visible on the web or the mobile app during development.

Tip during development: When updating the ambire-common version in the web app `package.json`, do not manually change your `package.json` and run `npm install`. Instead, execute `npm install "github:AmbireTech/ambire-common#v0.11.0"`. Otherwise, for some reason, package-lock file don't update accordingly and they persist refs to the previous ambire-common version. The issue either comes from npm instelf, or for something really specific in web's package-lock file.

Tip during development: There is another way to link `ambire-common`. The way it should work is to clone `ambire-common` wherever you want, then run `yarn link` inside `ambire-common` dir (`npm link` is not working atm). Then go to `ambire-wallet` or `wallet-mobile` dir and run `yarn link "ambire-common"`. In case of errors - delete `node_modules` in all projects dir, then run `yarn cache clean --force && npm cache clean --force`, `npm ci` and `yarn link "ambire-common"`. It's possible to need update for `ambire-wallet` postinstall script with the webpack hack - change `newValue: "include: [paths.appSrc, paths.appNodeModules + '/ambire-common'],"` with `newValue: "include: [paths.appSrc, /\.(ts|tsx)$/],"`, if there are some import errors and you are working in version without this update. Run `yarn link "ambire-common"` after every `npm i/ci` inside wallet projects, etc. Make sure there is no `node_modules` folder inside `ambire-common` as it looks like the peer deps does not act like such in this case.

Tip for hotfixes: In case you immediately need the change on PROD, you can simply (temporarily) ref in app's `package.json` instead a tag (`"ambire-common": "github:AmbireTech/ambire-common#v0.11.2"`) a specific commit SHA (`"ambire-common": "github:AmbireTech/ambire-common#2e8639e004044bda3fe7efa3290672d63bfe5f8a"`).

## Update contract/token info (generates `humanizerInfo.json`)

```
yarn generate:contractInfo
```

## Editor Config

Make sure your code editor has plugins that support the following configuration files: `.editorconfig`, `.prettierrc`, `tsconfig.json`, `eslintrc.js`, [`import-sorter.json`](https://github.com/SoominHan/import-sorter).
