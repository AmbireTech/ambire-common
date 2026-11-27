# Changing the bundled ERC-7730 registry

These rules are for developers and their AI agents who change `amendments.ts`, `amendments/*.json`
or `descriptors/`. A descriptor decides what the user sees before they sign. A wrong, missing or
hidden field can make a user sign a transaction that sends their funds somewhere else. Treat every
change here as a security change.

## How it works

- `npm run humanizer:update:erc7730Registry` builds `src/consts/erc7730/registry.json` from the
  latest commit of the upstream registry (https://github.com/ethereum/clear-signing-erc7730-registry),
  then applies Ambire's changes (see `amend.ts`). Review the `registry.json` diff of every update:
  it is the only check of what upstream changed.
- There are three kinds of change:
  - **amend** (`amendCalldataDescriptors`, `amendEip712Descriptors`): changes an upstream
    descriptor. The result is bundled as `ambire-change/<descriptor path>`, so it is clear which
    descriptors Ambire changed. It applies to **every** key that uses the descriptor (adds of it
    too), also keys upstream adds later (the summary lists those as "is also amended for"). Code
    that checks a descriptor's path must remove Ambire's prefixes first, with
    `getErc7730RegistryPath` (see `isOneInchDescriptor` in `humanize.ts`).
  - **add** (`addCalldataDescriptors`, `addEip712Descriptors`): points a key
    (`eip155:{chainId}:{address}`) at a descriptor, e.g. on a network upstream does not list.
  - **own descriptor** (`descriptors/registry/<project>/`): only when upstream has no descriptor for
    the contract. It is bundled as `ambire-new/<path>`, so it never takes the path of an upstream
    descriptor. Its `deployments` become its keys. It can include upstream descriptors, not other
    own ones. Change it by editing its file, never with an amend.
- Every build checks the names of the result (`getNamingProblems` in `amend.ts`): a descriptor
  without a prefix is upstream's unchanged, `ambire-change/` is an amend, `ambire-new/` is an own
  descriptor unchanged, and no index key uses an amended upstream descriptor.
- NEVER edit `registry.json` by hand. Always run the script.

## 1. Before you write a change: search upstream

- Search open and closed PRs and issues for the same change:
  - `gh pr list -R ethereum/clear-signing-erc7730-registry --state all --search "<function or field>"`
  - `gh api -X GET search/issues -f q="repo:ethereum/clear-signing-erc7730-registry is:pr is:closed is:unmerged <project>"`
  - Read the reviews: `gh pr view <n> -R ethereum/clear-signing-erc7730-registry --json comments,reviews`
- If the maintainers or the project team **rejected** the change, do not make it unless there is a
  very good reason, and that reason must be written in `reason` with the PR link. Examples of
  rejected changes and why: #2914 (chain id enum: does not fit Ledger), #2946 (formats with no
  fields: the user sees only a title), #2903 (`chainId` format: reference tools disagree on names).
- If an open upstream PR makes the same change, use the same values and link it.

## 2. Security audit against the contract source, on every chain

Do this for every `(chainId, address)` the change affects. For an amend, that is every key that uses
the descriptor, not only the ones in `addresses`.

1. Get the verified source on each chain:
   - Sourcify: `https://sourcify.dev/server/v2/contract/{chainId}/{address}?fields=compilation,proxyResolution,runtimeMatch`
     and `https://sourcify.dev/server/v2/contract/all-chains/{address}` (every chain at once)
   - Blockscout: `https://<explorer>/api/v2/smart-contracts/{address}`
   - Etherscan family (one key for all chains): `https://api.etherscan.io/v2/api?chainid={id}&module=contract&action=getsourcecode&address={address}&apikey=<key>`
2. The same address does not mean the same code. Compare the compilation and sources per chain. A
   raw bytecode hash differs when the contract has immutables, so do not rely on it alone.
3. Proxies: audit the implementation, not the proxy (`cast implementation <address>`). For a
   diamond, check each function: `cast call <address> "facetAddress(bytes4)(address)" $(cast sig "<fn(types)>")`;
   a zero address means the function does not exist on that chain. Note in the PR that the contract
   can be upgraded.
4. If the contract is not verified on a chain, verify it yourself on Sourcify:
   `POST /v2/verify/similarity/{chainId}/{address}` (same bytecode as a verified contract),
   `POST /v2/verify/etherscan/{chainId}/{address}` (import from an explorer), or
   `POST /v2/verify/{chainId}/{address}` with the standard JSON input. If you cannot verify it, leave
   that chain out.
5. Check the display against the source:
   - Every value that moves funds or gives an approval is shown: amount, token, recipient, spender,
     destination network, deadline, and the native value (`@.value`).
   - `visible: "never"` hides a field. `mustMatch` hides it and refuses any other value. `ifNotIn`
     shows it unless the value is in the list. Changing `mustMatch` to `ifNotIn` turns "refuse" into
     "show": make sure that is safe.
   - The `intent` says what the function really does; an approval reads as an approval.
   - Do not add a format with empty `fields` for a function that moves funds.
   - Nested calls (`calldata` format, `multicall`) point at the right callee and amount.
6. Write what you checked (chains, implementation addresses, functions) in the PR description.

## 3. Writing the change

- Change only what the reason needs.
- `reason`: what the change does for the user and when to remove it, e.g.
  "... (upstream PR #N; drop this once it is merged)".
- `addresses`: the keys you audited. When the summary says "is also amended for ...", audit those
  keys, then add them.
- To use an amended descriptor for more contracts, add their keys to `addCalldataDescriptors` (or
  `addEip712Descriptors`) with the **upstream** path, e.g. `'registry/lifi/calldata-LIFIDiamond.json'`.
  The script points them at the `ambire-change/` copy, and back at the upstream descriptor once the
  amend is removed. An add with an `ambire-change/` or `ambire-new/` path fails the build. Never put
  such a key in the amend's `addresses`: those are only keys upstream already points at the
  descriptor.
- Keys upstream points at an amended descriptor get the copy on their own, also ones it adds later.
  Add them to `addresses` once you audited them, so the update fails if they ever stop using it.
- Adds have no `reason` field. Put a comment above each group of adds that says why the keys are
  added and when they can be removed (usually: once the registry lists them, which fails the update).
- Check what you change so that a relevant upstream change fails the build:
  - `expectMatches(label, items, <exact count>)`; use `{ min }` only if the count changes often.
  - `expectEqual` for single values (the old format, old label, a key that must not exist yet).
  - Select fields by their **old** value, so the amend fails once upstream changes it.
- EIP-712 amends must keep the format keys (the index uses their hashes).
- A key can be in only one change (an amend's `addresses`, an add, or own `deployments`).
- Put large data (formats, enums) in `amendments/<project>.json`.
- Labels and intents are shown to users: plain language, no jargon.

## 4. Open the same change upstream

Propose every Ambire amend, add or own descriptor upstream too: the maintainers' review is a
second opinion on the change. Their feedback is welcome before the Ambire change merges, but
waiting for it is not required once the security review in section 2 is done. Apply any feedback
that comes later to the Ambire change. Upstream expects:
- One `registry/<entity>/` folder per PR; `$schema` is `../../specs/erc7730-v2.schema.json`.
- A test in `testsv2/<descriptor>.tests.json` for each changed function (an unsigned `rawTx` and
  `expected`); both reference runners must pass.
- `uvx --from "$(cat .github/requirements.txt)" erc7730 lint <file>`, then `erc7730 format`.
- No edits to `index.*.json`. If the descriptor has a file in `sigs/`, delete it in the same PR.

## 5. When upstream merges it, the update fails: that is expected

The first update after upstream merges the same fix (`npm run humanizer:update:erc7730Registry`)
fails, for example `The amend of <path> (<reason>): expected 14 ... found 0`, or for an add
`the registry already has <path> for <key>`. The Ambire-only amend script change (the amend or add
in `amendments.ts`) is then likely no longer needed.
Fix it soon: the update writes nothing while any check fails, so no other upstream change (new
descriptors, new networks, fixes) reaches the wallet until then.
1. Open the upstream PR linked in `reason`. If it does the same, delete the amend or add, and update
   its test in `src/consts/erc7730/bundledRegistry.test.ts`.
2. If upstream did something different, update the amend and its checks. Never loosen a check only
   to make the update pass.

## 6. Hardware wallets

Some descriptors work in Ambire but not on hardware wallets. Example: our LiFi amend shows the
destination network with an enum keyed by chain id, and some ids are above 255. Ledger stores an
enum value in one byte, so it cannot use this (upstream #2373, #2914). This is acceptable: as of
November 2026, Ambire does not send this registry to any hardware wallet (Ledger and PQ1 use their
vendors' own data). Re-check every such change if that ever changes, and do not propose such a
change upstream as it is.

## Public repository

This repo is public, and so are `reason`, the JSON files, test names and commit messages. Describe
what a change does, never how the old descriptor could be abused. Exploit details, user reports and
error-tracking links go only in the private `ambire-app` repo. No user addresses; contract addresses
are fine.

## Check and test

1. `npm run humanizer:update:erc7730Registry`, and read its summary (Ambire's changes, "also
   amended for", the size warning; the build fails above 4 MB).
2. Read the `registry.json` diff: only the descriptors and keys you expect may change.
3. Add a test for the result in `src/consts/erc7730/bundledRegistry.test.ts`. If you change
   `amend.ts`, add tests in `amend.test.ts`.
4. `npm run jest -- scripts/erc7730` and `npm run jest -- src/consts/erc7730`.
5. Try one real transaction of each changed function in the wallet.
