You are an AI Agent working in the core business-logic repository for the Ambire wallet, a self-custodial Web3 wallet for managing digital assets, smart accounts, DeFi interactions, and blockchain transactions across multiple EVM-compatible networks. This code is used by multiple environments (iOS and Android mobile apps, browser extensions for Chrome and Firefox, web apps) and is a critical part of the wallet's security and functionality. Changes to this code can have wide-reaching implications across all platforms, so extreme caution is required when making updates.

## Tech stack
typescript, ethers, viem, jest, hardhat

## Project overview
This package is not intended to run standalone - it is imported by environment-specific packages that provide platform-specific APIs and UI components. It contains the core business logic of the wallet, including controllers, libraries, and contracts.
- `src/controllers/` contains stateful classes that extend `EventEmitter`; they propagate updates via `this.emitUpdate()`
- `src/libs/` contains pure business logic without side effects
- `src/contracts/` contains Solidity contracts used by the wallet and relayer; compiled artifacts live in `contracts/compiled/`
- `src/services/` contains external service integrations (bundlers, RPC, ENS, etc.)

Note: This package does not include compiled JS and TS output in the repository. Each Ambire app compiles it individually as needed. The dist/ folder exists for internal use only. It may contain some compiled files, but it is not kept up to date and not updated on release. Do not rely on dist/ as a source of compiled code.

## Common commands
- Install dependencies: `npm install`
- Run one Jest test file: `npm run jest -- path/to/file.test.ts`
- Type-check: `npm run type:check`
- Lint and auto-fix source files: `npm run lint:fix`
- Compile contracts: `npm run compile:contracts`
- Run Hardhat compile + tests: `npm run hardhat`

## Rules

### Repository specific:
- Use `npm` for package management
- All code must be environment-agnostic; do not use platform-specific APIs (e.g. `window`, `document`, `React Native` APIs)
- NO new RPC providers should be constructed. ALWAYS use `ProvidersController`.

### Code quality:
- Code usually runs continuously for long periods of time (especially in browser extension environments), so memory leaks, listeners, and orphaned async processes can accumulate and cause performance, stability, or reliability issues over time.
- Always ensure subscriptions, event listeners, timers and other side effects are properly cleaned up
- NEVER delete existing comments when updating a code block; update inaccurate comments instead. Delete a comment only if the logic it describes is completely removed or the new logic is entirely self-explanatory
- NEVER swallow errors; log them and handle appropriately.
- NEVER modify git config or run destructive git operations
- NEVER commit unless explicitly requested by user
- NEVER stage changes unless explicitly requested by user

## Tests:
- ALWAYS write test cases that cover positive, negative, edge cases and security implications of the code you change or add.
- Before adding a new testing pattern, inspect nearby *.test.ts files or tests for a similar controller/library and follow the local style.
- NEVER cover up bugs and security issues by writing tests that expect buggy behaviour. If you find a bug, write a test that fails because of it, prefix it with `BUG:`, and report it to the human in your answer.

## Controllers
See `src/controllers/AGENTS.md` for a list of controllers and their responsibilities. Controllers are the core of the wallet's business logic and state management.