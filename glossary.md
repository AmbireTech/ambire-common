## Glossary

_The purpose of this glossary is to create a consensus on the terminology we use internally within the company, but also publicly in our communications._ For the purpose of eliminating errors and misconceptions, we aim to eliminate differences between internal terminology and what we use publicly.

**Smart account:** those include a number of security features such as account recovery and progressively upgradable security. In addition, you can pay for transactions in stablecoins, and do multiple actions in one transaction, therefore saving on fees. ✨ The cherry on top ✨ is that you're receiving $WALLET rewards for any funds you keep on them.

**Basic account:** this is the account type used in Metamask and most other wallets. Only use this if you're importing an account.

**Key:** a cryptographic key that is actually used to authorize interactions on accounts. A single smart account can have multiple keys authorized. A basic account only has one key that cannot be changed.

**Account authorization:** anything that the account does or authorizes - could be either a transaction or a signed message

**Signed message:** a piece of data that is digitally signed via an account (basic or smart) - this could be used for multiple purposes, including authorizing future actions (token permits/approvals), logging into apps, listing NFTs for sale, etc.

**Call:** a single smart contract interaction or value transfer, as part of transaction. Previously wrongly named `txn` in the source code.

**Transaction:** a set of instructions that are digitally signed via the account, meant to be executed right now. With smart accounts, those can contain multiple calls, while with basic account, there can only be one. A transaction normally transfers value, although not always - for example, you might just be changing your ENS address. A transaction runs atomically - meaning that either the whole set of instructions succeeds, or it entirely fails, leaving behind no changes to your account or the blockchain state.

**Smart transaction:** the type of transaction that smart accounts send. Internal developer name is `accountOp`. Those are different in that 1) they can contain multiple calls or 2) the fee can be paid din ERC20 tokens.

**Relayerless mode:** when you interact with a smart contract, but you pay the fee through a basic account in the network's native currency.

**Email-based account recovery:** timelock-based on-chain recovery using a recovery key kept by the relayer, unlocked via email

**Email-based keystore recovery password reset:** off-chain recovery of the local keystore, allowing you to reset the keystore passphrase via your email; we can also call this "Allow resetting device password via email"

**Cross-device account sync:** when adding the same email-enabled (associated with email vault) account on another device, allow to sync the key to the new device by approving that on the old one

**Default key for email accounts:** the key that is created initially for a certain email account

**Linked smart account:** a smart account where a certain key has been authorized to control, but not created originally with this key

**Account recovery scheduled:** when the account recovery has been initially triggered

**Account Recovery finalized:** when the account recovery is finalized and the new key is now enabled

**Associated Key:** any key that the user wants associated with the account; it's not necessarily authorized, as it has to be authorized on each network individually (or part of the deploy code); the associated keys for an account are a local setting - in other words, each account has a list of associated keys that the user may modify

**Authorized Key:** a key that is authorized for use (privileges[key] is set) for a specific account; it should be noted that each key must be (un)authorized individually on each network

**Device Password:** this is the keystore password; "device password" is better because it's self-explanatory that this is a local device password and not an account password

**V1 smart account:** an Ambire smart account that was originally created in Ambire v1. This account type will not have some features that are available in v2 (such as ERC-4337 support), but will generally include all the significant features.
