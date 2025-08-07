# High-level overview

## How to test

Run separately:

```
npx hardhat node
```

And then:

```
npx hardhat compile
npm test
```

To re-compile the deployless contracts, do this:

```
npm run compile:contracts
```

## Why class-based state containers instead of state container libraries (controllers)

We chose simple ES6 classes to implement controllers (shared business logic) rather than state containers.

Stateful classes can be easy to use, easy to implement, readable and can help with separation of concerns.

Generally, state containers carry two benefits over a stateful ES6 class: thanks to state immutability we know exactly what changed (therefore we can optimize rendering) and we can time-travel (replay any events) and test easier. They do add a lot of overengineering and complexity though.

However, classes are truly framework-agnostic, which is a requirement for the common repo. Combining state containers with this requirement leads to a lot more complexity.

- class benefits: easy to write and read; not too hard to test (if all side effect generating methods are passed externally); truly framework-agnostic
- class drawbacks: unable to know which properties changed, no time-travel

See also: https://medium.com/swlh/what-is-the-best-state-container-library-for-react-b6989a45f236

Classes for controllers are supposed to be stateful and be used directly in the application, which means:

- they should expose all state needed for rendering
- they should be responsible for the business logic but not responsible for app logic (for example, business logic is when to hide tokens from the portfolio but view logic is when to update the portfolio)
- they should avoid public methods that return values, and instead everything should be updated in the state; the user of the controller (the application or background process) **must never** expect/consume a result from a controller function
  - there may be internal functions that return results
  - there must not be public functions that return results (but they may be async in case they need to perform async work, in other words if you want to use `await`)
  - the UI should never `await` the async functions BUT the tests can do that and it might make their job easier
  - essentially all public functions should be actions
- they may keep internal state that is "hidden" (using `#` for private properties and functions) that is more convenient to work with, but expose a different state shape via getters to the application
- there should be _unidirectionality_: the main controller may listen to `onUpdate` from it's children, but the opposite must not happen; when a child controller needs to learn some new information that the main controller handles, the main controller should call the child's update function and pass that information along
- controllers should not do any work by themselves (implicit intervals, timeouts, etc.); it's acceptable to do long-term async work (like polling) if triggered by the user or the application; if the controller needs to be periodically updated, expose an `update` or `refresh` function that the application or parent controller must call
- errors that are fatal and related to unexpected/non-recoverable state should just `throw`, while errors that may happen in realistic conditions (eg async errors when calling `provider`) should all be caught
- methods may be asynchronous for two purposes: 1) using `await` in them and 2) knowing when their work is done in tests; those methods should absolutely not be awaited in the UI, and instead we should rely on update events and state changes
- `emitUpdate` should be called by each controller every time it updates it's own properties; it may be called onlhy once for multiple property updates as long as they happen in the same tick
- the controllers must not take any rich objects (instances of non-standard JS types) as arguments, every input should be fully serializable
- do not be afraid of nesting data for the controller state - sometimes it makes a lot of sense (eg pagination-speciffic properties)

Here are some related design decisions:

- The main controller is a singleton master controller, and all other controllers are supposed to be initialized by it: this is due to the fact that the app will have initialization/startup logic, and we **do not want to handle this** in the app itself. Whether the app is loaded will be reflected in the state exposed by the main controller.
- When it comes to calling the controllers for various functionalities, you can call sub-controllers of the main controller directly and this is by design. For example, to update the portfolio, we'd call `mainCtrl.portfolio.updateAccount(...)` rather than wire it through the main controller itself
  - whenever there's a mild inter-dependency, for example the main controller depending on the portfolio controller's output, it should watch it itself for updates and update it's own state accordingly
  - whenever there's a hard inter-dependency, for example one that affects more than one sub-controller, it will be best to wire the specific action through the main controller itself (`mainController.doSomething(...)`) because it's role is to effectively orchestrate such complex actions
  - the main controller can call or watch sub-controllers, but not vice versa, to maintain a directional relationship
  - for simplicity, we'll avoid passing data between sub-controllers internally and leave this to the app itself whenever possible; as a practical example, the `AccountPicker` will expose a list of accounts that can be added, but instead of internally having a method that will add those accounts on the main controller (which breaks the unidirectionality of the previous point), we'll just expose them - then, the app can call `mainController.addAccounts(mainController.accountPicker.selectedAccounts)`
- Properties that are not meant to be exposed or serialized should start with `#` in order to [make them private](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Classes/Private_class_fields). The public/private modifiers in TypeScript do not achieve the same effect since they only serve as guidelines for the TS compiler itself, but they should be used alongside `#` anyway
- Do not rely on interior mutability and internal cross-references

Those controllers are essentially classic state containers: you can call them with some actions, those methods should never return anything, but they can result in one or more state changes, which will emit an `update` event, forcing the UI to re-render with the latest state.

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

1. When a key is authorized, you set `privileges[keyAddr]` to a hash of a struct that contains recovery data (`recoveryInfo`) - the keys that can recover this account and the timelock (let's call those "recovery keys"; this is normally set to the email vault key)
2. If access to that authorized key is lost (or access to the account in general), any of the recovery keys can sign a bundle with a special kind of signature (called recovery signature)
3. You can `execute()` this bundle with this signature, but it will not execute immediately - instead, it will start the timelock
4. Once the timelock is mature, you can `execute()` the same bundle with the same signature - this time, it will execute

The intended use case is as follows:

1. An email account is created for the user; we generate a fresh key and we store it in the keystore; and we set the `recoveryInfo` to a 72 hour timelock and one key, which is the key of the email vault (held by the relayer, we call this "email vault key")
2. If the user loses their keystore (eg their SSD fails, or they lose their passphrase), they may trigger the recovery using the email vault on every network individually; triggering the recovery involves creating a new local key, and signing a bundle to authorize it via the email vault key; let's call this bundle "the recovery bundle"
3. Once the recovery timelock is mature, the relayer will simply execute the recovery bundle BEFORE any normal bundle that the user wants to execute that they're signing with their new local key

#### DKIM Recovery: basic mode of operation

The DKIM recovery replaces the timelocked recovery described above and works as follows:

1. The user receives an email that includes the new key address in the subject
2. The user replies to the email with anything
3. The relayer extracts the signature from this email and prepares the canonized DKIM headers and body hash for submission to the on-chain code (DKIM signature validator), which verifies `subject` and `to` to prevent phishing and verify the recovery key (the new key we give privileges too)
4. The relayer also needs to produce another signature via the email vault recovery key (normal EOA signature) and provide it alongside, for extra security - in order to provide this signature the relayer will enforce an off-chain timelock (to protect against DKIM keys getting compromised, email accounts getting compromised, etc.).
5. The two signatures are merged and can now be used for finalizing the recovery on any chain (this signature is not replay-protected by nonces, but by uniqueness of the operation)

This requires the [externally verified signatures](https://github.com/AmbireTech/ambire-common/pull/297) improvement of the Ambire contracts. Each user has their recovery settings set in a struct that is passed as part of the signature, and then verified against `privileges` like this: `require(privileges[key] == keccak256(abi.encode(recoveryAccInfo)))` every time a DKIM recovery signature is verified.

This `accInfo` struct will include:

```
  dkimSelector
  dkimPublicKey
  // other values of the DKIM record?
  secondaryKeyAddr // relayerAddr
  emailFrom // or multiple
  trustedTo // or multiple
  waitUntilAcceptAdded // if a record has been added by `authorizedToSubmit`, we can choose to require some time to pass before accepting it
  waitUntilAcceptRemoved // if a record has been removed by the `authorizedToRemove`, we can choose to require some time to pass before accepting that ramoval
  acceptUnknownSelectors
```

You can think of the DKIM recovery signature as a multi-signature between the email vault backup key (held by the relayer, but we can also allow the user to have this key) and the DKIM key held by the email provider.

##### Nuclear option: 1/2 recovery

The happy path requires a compound 2/2 signature. However, in case the relayer is not available, the user needs to be able to recover their account using DKIM alone. For this case, we'll enforce an additional on-chain timelock. It's a mode of last resort, but it also needs to be secure against attack vectors like DKIM keys getting compromised, email providers getting compromised, email accounts getting compromised, etc.

##### Summarized list of all timelocks in the DKIM system

- Nuclear option: only 1/2 signatures, on-chain timelock
- Relayer off-chain timelock: the relayer will simply wait some time before providing the email vault key signature; this preserves the timelock UX and security benefits without having to ask the user to trigger an on-chain timelock on every chain they use the account on
- Pseudo-timelocks for accepting the addition and revokation of DKIM public keys: each user can set in their account settings (stored as a hash in `privileges[key]`) whether they want to accept unknown (different from their originally set) selectors, and if so, how much time needs to pass before accepting the submission of a record, or the revokation of a record (read why below)
- There may be additional timelocks implemented on-chain in the future for the `authorizedToSubmit` and `authorizedToRevoke` addresses (they may be set to a timelock contract).

#### DKIM Recovery: public key management

In order for DKIM recovery to work, there must be a reliable DNS oracle on-chain. For that purpose, we will use the ENS DNSSec oracle.

Becase DNSSec proofs contain no time in them, it's not possible to introduce the concept of "latest DNS record" on-chain without significant compromises. This is why we'll accept any DNS TXT record of a DKIM key (`${selector}._domainKey.{$domain}`) and record it on-chain, but we'll also allow revoking of any of those keys.

##### Adding

The DKIM recovery contract will have an `authorizedToSubmit` variable, which indicates the address of whoever is authorized to submit. Initially, for safety reasons, this will be the Ambire team. Keep in mind any user can set their own DKIM accepted public keys, this is only for emails signed with unknown selectors.

Later on, this could be set to a santinel value that allows _anyone_ to submit records. This should be safe, because they go through a DNSSec proof, except in the case in which someone might submit a proof for an old DNS record, in which case revoking is needed. Bear in mind that because of the nature of DKIM, we expect that no email provider will ever _change_ a DNS TXT DKIM record in production (due to DNS caches, this will lead to many dropped emails), so this should be a near-impossible case.

Upon submitting, we will verify the DNSSec proof, parse the DNS TXT record, but only store `dkimKeys[keccak256((publicKey, domainName))] = { dateAdded, dateRevoked }` on-chain.

Each user can set whether they want to accept unknown selectors, and can set the time before starting to accept newly submitted records.

##### Revoking

The DKIM recovery contract will have an `authorizedToRevoke` variable, which is an address of whoever is authorized to revoke DKIM public keys. This should be set to a multisig or a timelocked wallet, but it can be set to a regular wallet as well, because the user settings include `waitUntilAcceptRemoved` (see below).

Each user can set the time they want to wait before accepting revokations (`waitUntilAcceptRemoved`), making sure that `authorizedToRevoke` cannot grief them by constantly revoking records.

Once revoked, the same key cannot be added back.

The `waitUntilAcceptRemoved` is _highly recommended_ to be shorter than the contract timelock for accepting 1/2 signatures, because in the case that a DKIM key is compromised, we want to be able to revoke it before the attacker can take a hold of an account via the 1/2 signatures timelock.

### Keystore password reset via email

This is an off-chain recovery method that allows regaining access to your local keystore if you have forgotten the keystore passphrase.

This only works if you still have the keystore in local storage, but it works across all chains as it's performed off-chain.

The keystore itself supports encryption via multiple secrets. This method works by simply generating a random secret and encrypting the keystore with it as well, and then uploading this secret in the email vault without storing it locally. This way, the relayer can unlock that secret following email confirmation, and you can set a new passphrase for the local keystore now that you have it unlocked.

The UX will be simple:

1. Enable keystore recovery via the email vault (if you have an email vault)
2. If you forget your passphrase, you click a button/link to set a new one and you receive an email asking you if you really want to do that
3. You click the confirmation button on the email, and it forwards you to the extension again, where you can set a new passphrase
4. Done

### Key sync

This is not an account/keystore recovery method but rather a way to use the same account on multiple devices.

When adding an email vault on a new device, you'll be given the option to add all accounts associated with that email vault (initially only one will be allowed).

By default, this will add the account in read-only mode. To enable signing transactions and messages, there will be a procedure in which you will be prompted on the original device to authorize the new device. If the user agrees, the original device will encrypt the underlying key with the public key of the new device and send it through the Ambire backend.

This is fully secure as the device private key (keystore `mainKey`) has really high entropy, and the backend only stores the encrypted data for 3 minutes.

## Documentation

- [Ambire Flows](<https://github.com/AmbireTech/ambire-app/wiki/Ambire-Flows-(wrap,-sign,-payment,-broadcast)#ERC-4337-Recovery>)

## Libraries

### deployless.ts

Deployess is a library that allows us to perform off-chain calls through `eth_call` to contracts that are not deployed.

This lets us practically execute any arbitrary code off-chain and get the result without having to pre-deploy contracts. This is used by libraries like `portfolio`, or to do any complex batch operation that would otherwise require numerious `eth_call`s.

It achieves this through two methods: either a magic proxy contract, or the [state override set](https://chainstack.com/deep-dive-into-eth_call/).

Let's look into both of them:

- [magic proxy contract](https://github.com/AmbireTech/relayer/blob/93346dcdc1b51837a377cd3ce5ba34b75e2f7182/src/velcro-v3/contracts/Deployless.sol): this is a contract that, upon it's deployment, deploys another contract and calls it, and returns the result; normally, Solidity doesn't allow contracts to return data from the constructor, but we hack this via assembly; this method is supported by every RPC node but it's limited to [24kb of input](https://eips.ethereum.org/EIPS/eip-170); this restriction [may](https://ethereum-magicians.org/t/removing-or-increasing-the-contract-size-limit/3045/23) [be](https://github.com/ethereum/EIPs/issues/1662) lifted
- [state override set](https://github.com/ethereum/go-ethereum/issues/19836): this is a little known feature of `eth_call` that lets us pass any state overrides that will be applied before executing the call, like overriding an address' balance, contract code, or even parts of it's state; it is not supported by all RPC nodes

The library can auto-select which one to chose based on the availability of the state override set.

**WARNING: `deployless.ts` DOES NOT support running the constructor of the contracts. Refrain from using a constructor for deployless contracts.**

### portfolio.ts

TODO

#### Velcro V3 return format

##### Token discovery hints: `https://relayer.ambire.com/velcro-v3/1/0xa07D75aacEFd11b425AF7181958F0F85c312f143/hints`

Return format:

```javascript
{
    chainId: number,
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

### deployless.ts

This is how to generate a JSON for a deployless contract:

```
ts-node src/libs/deployless/compileUtil.ts  > src/libs/estimate/estimator.json
```

#### Design decisions (mostly about keystore)

- decided to store all keys in the Keystore, even if the private key itself is not stored there; simply because it's called a Keystore and the name implies the functionality
- handle HW wallets in it, so that we handle everything uniformly with a single API; also, it allows future flexibility to have the concept of optional unlocking built-in; if we have interactivity, we can add `keystore.signExtraInputRequired(key)` which returns what we need from the user
- signing is presumed to be non-interactive at least from `Keystore` point of view (requiring no extra user inputs). This could be wrong, if hardware wallets require extra input - they normally always do, but with the web SDKs we "outsource" this to the HW wallet software itself; this may not be true on mobile. In case we require interactivity, we'll implement `signExtraInputRequired`.
- awareness of key type and multisigs: key meta should contain what type of key it is
- no multiple components of private keys, one key is one private key; if it's part of a multisig, this should be reflected via meta
- no need for separata methods to load from storage, we will always load on demand, since every method is async anyway
- the keystore will only store single keys and will not concern itself with multisigs or recovery info, even if we use it in an identity as part of a multisig (like QuickAccs, even tho we won't use them in the extension); this will be handled by a separate mapping in the Account object

### Audits

- [Code4rena](https://code4rena.com/reports/2023-05-ambire)
- [Krum Pashov](https://github.com/pashov/audits/blob/master/solo/Ambire-security-review.md)
