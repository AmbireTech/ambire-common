# TornadoCashController

Tornado Cash accounts: at most one per recovery phrase (account index 0), with no address, kept
outside `AccountsController`. While one is selected, `SelectedAccountController.account` is null and
`privateAccount` is `{ providerId: 'tornadoCash', seedId }` - the same model as Privacy Pools.

## Where the SDK runs

`@kohaku-eth/tornado-cash` always starts Web Workers, which an MV3 service worker cannot, so the
controller never imports it. The platform injects a `TornadoCashPluginFactory` (on Chrome, an
offscreen document - see `src/web/extension-services/tornado-cash/` in the app). Without one
(mobile, Firefox) the feature is unavailable. One plugin runs at a time, for the selected account;
selecting another account or locking stops it. A plugin whose document closed fails with
`TORNADO_CASH_PLUGIN_STOPPED_MESSAGE` and is replaced once.

## Keys

The plugin asks for keys by path. `KeystoreController.derivePrivacyKey(seedId, 'tornadoCash', path)`
allows only `m/29795'/1'/0'/{0|1|2}'/{n}'` (nullifier, salt, paymaster signer per note). That check
is the security boundary that keeps the plugin away from EVM keys. Keys are cached per path while
the plugin lives.

## Sync

On opening the account (`syncIfStale`, 10 minutes), only once its phrase is backed up. The plugin
reads the pools' history from the saga CDN and the latest blocks from the chain; a cold read takes
about a minute. Notes and balances live in memory only, so nothing on the device links a deposit
to its withdrawal.

## Send to an account (deposit)

`buildDepositCalls` splits the amount into notes (`splitIntoTornadoCashNotes`, at most 10), asks the
plugin for the calls and checks every one: supported pools only, exactly the expected notes,
approvals only to those pools. A deposit built before the previous one is mined would reuse its
notes, so a broadcast deposit blocks a rebuild with the same commitments for 15 minutes.

## Send from an account (withdrawal)

`withdrawal.ts`: proved and signed in the plugin (paymaster mode, deterministic delegator), checked
by `readTornadoCashPaymasterWithdrawal` (recipient, pool, adapter, fee, forward of `amount - fee`),
then sent to the bundler. Only whole notes can be sent. Not simulated before broadcast yet.

## Known limits

- The SDK swaps the two USDC pools' fee adapters; `TORNADO_CASH_POOLS` holds the right ones and is
  passed to the SDK as its paymaster config.
- The SDK re-saves its whole state (about 200 MB) after every sync.
- No activity, dApp requests or note import.
