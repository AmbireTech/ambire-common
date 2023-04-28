# High-level overview

## Why classes instead of state containers
We chose simple ES6 classes to implement controllers (shared business logic) rather than state containers.

Stateful classes can be easy to use, easy to implement, readable and can help with separation of concerns.

Generally, state containers carry two benefits over a stateful ES6 class: thanks to state immutability we know exactly what changed (therefore we can optimize rendering) and we can time-travel (replay any events) and test easier. They do add a lot of overengineering and complexity though.

However, classes are truly framework-agnostic, which is a requirement for the common repo. Combining state containers with this requirement leads to a lot more complexity.

* class benefits: easy to write and read; not too hard to test (if all side effect generating methods are passed externally); truly framework-agnostic
* class drawbacks: unable to know which properties changed, no time-travel

See also: https://medium.com/swlh/what-is-the-best-state-container-library-for-react-b6989a45f236

## How account recovery/restore works in Ambire

### What's an email vault
**TODO** But you can read [this](https://github.com/AmbireTech/ambire-app/issues/834) for some background.

An email vault is a mechanism on the relayer to safeguard arbitrary secrets and a recovery key, via your email.

### Recovery/backup methods
There are 3 types of account recovery/restoration in Ambire 2.0:

### On-chain account recovery via email
This works via [recovery signatures](https://github.com/AmbireTech/ambire-common/blob/984e9f1d77c1756292dc6304baf98080211f97b0/contracts/AmbireAccount.sol#L108-L141) and is very similar in operation to the legacy `QuickAccManager` recoveries.

This recovery must be performed for each network (chain) individually because it involves on-chain state, and is intended to have a timelock.

The way it works is the following:
1. When a key is authorized, you set `privileges[keyAddr]` to a hash of a struct that contains recovery data (`recoveryInfo`) - the keys that can recover this account and the timelock (let's call those "recovery keys")
2. If access to that authorized key is lost (or access to the account in general), any of the recovery keys can sign a bundle with a special kind of signature (called recovery signature)
3. You can `execute()` this bundle with this signature, but it will not execute immediately - instead, it will start the timelock
4. Once the timelock is mature, you can `execute()` the same bundle with the same signature - this time, it will execute

The intended use case is as follows:
1. An email account is created for the user; we generate a fresh key and we store it in the keystore; and we set the `recoveryInfo` to a 72 hour timelock and one key, which is the key of the email vault (held by the relayer)
2. If the user loses their keystore (eg their SSD fails, or they lose their passphrase), they may trigger the recovery using the email vault on every network individually; triggering the recovery involves creating a new local key, and signing a bundle to authorize it via the email vault key; let's call this bundle "the recovery bundle"
3. Once the recovery timelock is mature, the relayer will simply execute the recovery bundle BEFORE any normal bundle that the user wants to execute that they're signing with their new local key

### Keystore recovery via email
This is an off-chain recovery method that allows regaining access to your local keystore if you have forgotten the keystore passphrase.

This only works if you still have the keystore in local storage, but it works across all chains as it's performed off-chain.

The keystore itself supports encryption via multiple secrets. This method works by simply generating a random secret and encrypting the keystore with it as well, and then uploading this secret in the email vault without storing it locally. This way, the relayer can unlock that secret following email confirmation, and you can set a new passphrase for the local keystore now that you have it unlocked.

The UX will be simple:
1. Enable keystore recovery via the email vault (if you have an email vault)
2. If you forget your passphrase, you click a button/link to set a new one and you receive an email asking you if you really want to do that
3. You click the confirmation button on the email, and it forwards you to the extension again, where you can set a new passphrase
4. Done

### Ambire Cloud
This is not an account/keystore recovery method but rather a way to log into the same email account on multiple devices (sync it across devices).

When enabled, the one and only default private key (you can add more signer keys manually, but every email acc will start with one "default" key) associated with a specific email account is encrypted with the keystore passphrase and uploaded to the email vault.

This allows you to import this account on different devices (or "log in").

## Libraries

### deployless.ts
Deployess is a library that allows us to perform off-chain calls through `eth_call` to contracts that are not deployed.

This lets us practically execute any arbitrary code off-chain and get the result without having to pre-deploy contracts. This is used by libraries like `portfolio`, or to do any complex batch operation that would otherwise require numerious `eth_call`s.

It achieves this through two methods: either a magic proxy contract, or the [state override set](https://chainstack.com/deep-dive-into-eth_call/).

Let's look into both of them:
* [magic proxy contract](https://github.com/AmbireTech/relayer/blob/93346dcdc1b51837a377cd3ce5ba34b75e2f7182/src/velcro-v3/contracts/Deployless.sol): this is a contract that, upon it's deployment, deploys another contract and calls it, and returns the result; normally, Solidity doesn't allow contracts to return data from the constructor, but we hack this via assembly; this method is supported by every RPC node but it's limited to [24kb of input](https://eips.ethereum.org/EIPS/eip-170); this restriction [may](https://ethereum-magicians.org/t/removing-or-increasing-the-contract-size-limit/3045/23) [be](https://github.com/ethereum/EIPs/issues/1662) lifted
* [state override set](https://github.com/ethereum/go-ethereum/issues/19836): this is a little known feature of `eth_call` that lets us pass any state overrides that will be applied before executing the call, like overriding an address' balance, contract code, or even parts of it's state; it is not supported by all RPC nodes

The library can auto-select which one to chose based on the availability of the state override set.


### portfolio.ts

TODO

#### Velcro V3 return format

##### Token discovery hints: `https://relayer.ambire.com/velcro-v3/ethereum/0xa07D75aacEFd11b425AF7181958F0F85c312f143/hints`

Return format:

```javascript
{
    networkId: string,
    accountAddr: string,
    // array of addresses of erc20 tokens discovered for this address; some of them may have zero balance (the address has had them in the past); Velcro V3 filters those results to include only ones that are included on Coingecko, as a form of spam/scam detection
    erc20s: string[],
    // object containing objects describing erc721s (NFTs)
    erc721s: {
        // this is either { isKnown: boolean, enumerable: true } or { isKnown: boolean, enumerable: false, tokens: string[] }
        // in case enumerable is false, tokens will be an array of all token IDs that are discovered for this NFT collection
        [nftAddr]: { isKnown: boolean, enumerable: boolean, tokens?: string[] }
    }

}
```


### keystore.ts

The keystore is a library that can store two types of keys: external and internal. External keys are recorded merely with metadata, and do not require the keystore locking to be initiated. Internal keys are stored in the form of encrypted private keys. Encryption works via one master key which is itself stored encrypted via any number of secrets.

Unlocking the keystore works by decrypting and loading the main encryption key into memory. Anything could be a secret, but in reality it's the user's passphrase or a special recovery secret stored in the email vault (to enable email-based keystore recovery).

By having a separate main encryption key, we enable multiple secrets (passphrase AND email-based keystore recovery), and we also ensure that there's no copy of the user's passphrase kept in memory.


#### Design decisions
- decided to store all keys in the Keystore, even if the private key itself is not stored there; simply because it's called a Keystore and the name implies the functionality
- handle HW wallets in it, so that we handle everything uniformly with a single API; also, it allows future flexibility to have the concept of optional unlocking built-in; if we have interactivity, we can add `keystore.signExtraInputRequired(key)` which returns what we need from the user
- signing is presumed to be non-interactive at least from `Keystore` point of view (requiring no extra user inputs). This could be wrong, if hardware wallets require extra input - they normally always do, but with the web SDKs we "outsource" this to the HW wallet software itself; this may not be true on mobile. In case we require interactivity, we'll implement `signExtraInputRequired`.
- awareness of key type and multisigs: key meta should contain what type of key it is
- no multiple components of private keys, one key is one private key; if it's part of a multisig, this should be reflected via meta
- no need for separata methods to load from storage, we will always load on demand, since every method is async anyway
- the keystore will only store single keys and will not concern itself with multisigs or recovery info, even if we use it in an identity as part of a multisig (like QuickAccs, even tho we won't use them in the extension); this will be handled by a separate mapping in the Account object
