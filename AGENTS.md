You are an AI Agent working in the core business-logic repository for the Ambire wallet. This code is used by multiple environments (mobile, extension, standalone websites) and is a critical part of the wallet's security and functionality. Changes to this code can have wide-reaching implications across all platforms, so extreme caution is required when making updates.

## Tech stack
typescript, ethers, viem, jest, hardhat

## Project overview
- `src/controllers/` contains stateful classes that extend `EventEmitter`; they propagate updates via `this.emitUpdate()`
- `src/libs/` contains pure business logic without side effects
- `src/contracts/` contains Solidity contracts used by the wallet and relayer; compiled artifacts live in `contracts/compiled/`
- `src/services/` contains external service integrations (bundlers, RPC, ENS, etc.)

## Rules

### Repository specific:
- Use `npm` for package management
- All code must be environment-agnostic; do not use platform-specific APIs (e.g. `window`, `document`, `React Native` APIs)
- NO new RPC providers should be constructed. ALWAYS use `ProviderController`.

### Code quality:
- Always ensure subscriptions, event listeners, timers and other side effects are properly cleaned up
- NEVER delete existing comments when updating a code block; update inaccurate comments instead. Delete a comment only if the logic it describes is completely removed or the new logic is entirely self-explanatory
- NEVER swallow errors; log them and handle appropriately.
- NEVER modify git config or run destructive git operations
- NEVER commit unless explicitly requested by user
- NEVER stage changes unless explicitly requested by user

## Tests:
- ALWAYS write/update existing tests for changes that you make. Propose missing test cases if you find gaps in the existing coverage. 
- ALWAYS write test cases that cover positive, negative, edge cases and security implications of the code you change or add.
- ALWAYS make a quick tool call to another controller/library when writing new code to check how tests are written there and follow the same patterns. NEVER invent new testing patterns before checking existing ones in the codebase.
- NEVER cover up bugs and security issues by writing tests that expect buggy behaviour. If you find a bug, write a test that fails because of it, prefix it with `BUG:`, and report it to the human in your answer.

## Controllers
See `src/ambire-common/src/controllers/AGENTS.md` for a list of controllers and their responsibilities. Controllers are the core of the wallet's business logic and state management.