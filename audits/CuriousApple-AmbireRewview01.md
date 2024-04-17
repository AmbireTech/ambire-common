
<table>
    <tr><th></th><th></th></tr>
    <tr>
        <td>
        <img src="https://pbs.twimg.com/profile_images/1587056865027973128/MugicDd0_400x400.jpg" width="250" height="250" /></td>
        <td> 
            <h1>Ambire Wallet</h1>
            <h2>V2 (ERC4337, Paymaster, DKIM Recovery)</h2>
            <p>Prepared by: Curiousapple, Independent Security Researcher</p>
            <p>Duration: 4 days </p>
            <p>Date of Delivery: 24 Oct 2023 </p>
            <p>Original gist [here](https://gist.github.com/0xcuriousapple/3a670a8980991833df9ee124a6934e52#file-ambirereview01-md) </p>
        </td>
    </tr>
</table>

# About 

## [Ambire](https://www.ambire.com/)
Ambire is one of the pioneers of smart contract wallets, with version 1 launched in late 2021. 
This particular update, version 2, focuses on their implementation of EIP4337, Paymaster, and a novel recovery scheme, DKIM. 
The DKIM recovery system allows users to perform self-custodial email/password authentication on-chain and recover their wallet.</br> 
More details about DKIM recovery can be found [here](https://ambire.notion.site/Ambire-self-custodial-email-password-authentication-via-DKIM-324a57312b3e4fe7b66935318cbea435)


## Curiousapple 🦇

Abhishek Vispute, known online as 'Curiousapple', is an independent smart contract security researcher. 
Previously, he served as a lead smart contract auditor at [Macro](https://0xmacro.com/) and is currently working independently.</br>
His auditing experience covers diverse set of protocols, including DeFi, Bridges, NFTs, DAOs, and Games, in all of which he has discovered severe bugs. </br>
You can find his previous work and contact [here](https://github.com/abhishekvispute/curiousapple-audits/blob/231caa00d7f0ba8b016b4980b300e6a2fcd93815/README.md) </br>


# Scope

**Repo:** [ambire-common](https://github.com/AmbireTech/ambire-common) </br>
**Branch:** v2 </br>
**Commit:** `f411456c06a409bbcbbee0c12c7496916202860b`</br>
**Contracts:**</br>

1. contracts/AmbireAccount.sol
2. contracts/AmbirePaymaster.sol
3. contracts/DKIMRecoverySigValidator.sol

Please note that none of the following dependencies or libraries were in scope, as they were assumed to be functioning correctly. 

- `SignatureValidator.sol`
- `Strings.sol`
- `Base64`
- `BytesUtils`
- `RSASHA256`
- `DNSSECImpl`
- `RRUtils`
- `OpenZeppelinStrings`

# Summary of Findings

No severe issues were found. </br>

<table>
    <tr><th>Acronym</th><th></th></tr>
    <tr><td>C<td>Critical</td></tr>
    <tr><td>H<td>High</td></tr>
    <tr><td>H<td>Medium</td></tr>
    <tr><td>L<td>Low</td></tr>
    <tr><td>Q<td>Quality</td></tr>
</table>


| ID     | Title                        | Status |
| ----------- | ---------------------------- | ----- |
| C-01 &nbsp;| Anyone can take control of someone's wallet by encoding the address inside the subject | Fixed |
| M-01 &nbsp;| Users can replay Ambire's paymaster signatures and make Ambire pay more than intended if `Entrypoint` is changed  | Fixed |
| Q-01 &nbsp;| The old nomenclature of "Identity" is still being followed  | Fixed |
| I &nbsp;| Informationals  | - |

# Detailed Findings

## [C-01] Anyone can take control of someone's wallet by encoding the from address inside the subject

**Impact: High** </br>
**Likelihood: High**

Ambire allows users to recover their wallets using DKIM signatures if the DKIM signature is done on headers equal to what the user has specified in their account info. 
However, due to a flaw in the parsing logic of [`_verifyHeaders`](https://github.com/AmbireTech/ambire-common/blob/f411456c06a409bbcbbee0c12c7496916202860b/contracts/DKIMRecoverySigValidator.sol#L398-L399), anyone can spoof the `emailFrom` address and take control of the wallet.

Let's take the following header as an example:

```solidity
to: adamcrein@gmail.com
subject: Give permissions to 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 SigMode 0
message-id: <CAKXuq_X92FgFsmP_jvEyeTJDprj9_QG_fV=K4F3DWK50-gGQ0g@mail.gmail.com>
date: Mon, 21 Aug 2023 05:01:56 +0300
from: test testov <alice@gmail.com>

```

While verifying headers, Ambire's current logic is as follows:

- The "to" header should **start** with "emailTo" (`startsWith`).
- The "subject" header should **contain** the string "subject:Give..." (`split`).
- The "from" header should **contain** "emailFrom" after "from:" (`find`).

All of these checks are performed from **top to bottom, left to right**.

Now, to gain control of Alice's wallet, what if I pass the following subject:

```solidity
to: adamcrein@gmail.com
subject: **from:test testov <alice@gmail.com> subject:Give permissions to 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 SigMode 0**
message-id: <CAKXuq_X92FgFsmP_jvEyeTJDprj9_QG_fV=K4F3DWK50-gGQ0g@mail.gmail.com>
date: Mon, 21 Aug 2023 05:01:56 +0300
from: mr.robot <attack@gmail.com>

```

The subject will be identified as "subject:Give permissions to 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 SigMode 0" since it exists as expected by the `verifyHeaders` logic. 
Ambire's `verifyHeaders` will start from the top and identify the "from" as the one I spoofed in the subject ([alice@gmail.com](mailto:alice@gmail.com)) and not the actual one ([attack@gmail.com](mailto:attack@gmail.com)) since the search stops at the first find. 
This would basically allow someone to gain access to user wallets for matching selectors and all user wallets who accept unknown selectors.

### Recommendation

Consider correcting the parsing logic so that it is independent of user-dependent fields.

### Status

[Fixed](https://github.com/AmbireTech/ambire-common/pull/400)

---

## [M-01] Users can replay Ambire's paymaster signatures and make Ambire pay more than intended if `Entrypoint` is changed

**Impact: Medium** </br>
**Likelihood: Medium**

`Entrypoints` can change and each one has its own nonce management. 
Now the question is, if the `entrypoint` is changed from A to B, can a transaction that was already executed using A for nonce N1 be replayed on B?

`Entrypoint` resolves this attack vector by encoding the `entrypoint` address to the `userOp` hash.</br> 
[`getUserOpHash`](https://github.com/eth-infinitism/account-abstraction/blob/73a676999999843f5086ee546e192cbef25c0c4a/contracts/core/EntryPoint.sol#L298`)

The vulnerable case in Ambire’s scenario is `validatePaymasterUserOp`.</br>

Ambire's `validatePaymasterUserOp` ignores the passed `userOphash` from the `entrypoint` and derives its own hash, due to cyclic dependency.</br>
[Source](https://github.com/AmbireTech/ambire-common/blob/f411456c06a409bbcbbee0c12c7496916202860b/contracts/AmbirePaymaster.sol#L48-L49)

### Recommendation

Consider adding `entrypoint` to the signed digest of `validatePaymasterUserOp`

### Status

[Fixed](https://github.com/AmbireTech/ambire-common/commit/3dfd721c947debae2e6b9ede8698278d838ab194)

---

## [Q-01] The old nomenclature of "Identity" is still being followed
Instances : 
1. [require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');](https://github.com/AmbireTech/ambire-common/blob/b3c3d1b20211950bf607add7d92248a9dbdc9b82/contracts/AmbireAccount.sol#L106-L107)
2. [require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');](https://github.com/AmbireTech/ambire-common/blob/b3c3d1b20211950bf607add7d92248a9dbdc9b82/contracts/AmbireAccount.sol#L205-L206)
3. [require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');](https://github.com/AmbireTech/ambire-common/blob/b3c3d1b20211950bf607add7d92248a9dbdc9b82/contracts/AmbireAccount.sol#L118-L119)
4. [require(msg.sender == address(this), 'ONLY_IDENTITY_CAN_CALL');](https://github.com/AmbireTech/ambire-common/blob/b3c3d1b20211950bf607add7d92248a9dbdc9b82/contracts/AmbireAccount.sol#L133-L134)
5. [// using our own code generation to insert SSTOREs to initialize `privileges` (IdentityProxyDeploy.js)](https://github.com/AmbireTech/ambire-common/blob/b3c3d1b20211950bf607add7d92248a9dbdc9b82/contracts/AmbireAccount.sol#L17-L18)

### Recommendation
Consider replacing the old nomenclature of "Identity" with "AmbireAccount".

### Status
[Fixed](https://github.com/AmbireTech/ambire-common/commit/40812f241c38f8db859d8769b9b1fd16541869d2)

---

## Informationals 

1. Any call made to `AmbireAccount` will be successful if `fallbackHandler == address(0)`. </br>
2. Since `chain.id` is not included in external signatures (DKIM), a DKIM recovery on one chain of a wallet could be executed on another chain by anyone. </br>
3. Low-level calls will return success for all cases if `to` is not a contract.</br>
4. Once given DKIM key is disabled it can not be used again since `key.isExisting` persists.
5. There is no guarantee that all `ExecuteArgs` of `executeMultiple()` would be executed at once only. 
Since the signature verification is done on individual set of `toExec.calls`, anyone can call `execute()` directly and execute individual actions if the nonce is in sync.</br>
For example, let's consider Alice calls `executeMultiple⇒[Set A, Set B]`.</br> 
Anyone can execute actions of set A without executing actions from set B. 
Once the nonce is incremented by another action, the same applies to set B.
---
# Disclaimer 

curiousapple's review is limited to identifying potential vulnerabilities in the code. It does not investigate security practices, operational security, or evaluate the code relative to a standard or specification.</br> 
curiousapple makes no warranties, either express or implied, regarding the code's merchantability, fitness for a particular purpose, or that it's free from defects.</br>
curiousapple will not be liable for any lost profits, business, contracts, revenue, goodwill, production, anticipated savings, loss of data, procurement costs of substitute goods or services, or any claim by any other party.</br> 
curiousapple will not be liable for any consequential, incidental, special, indirect, or exemplary damages, even if it has been advised of the possibility of such damages.</br>
This review does not constitute investment advice, is not an endorsement, and is not a guarantee as to the absolute security of the project.</br> 
By deploying or using the code, users agree to use the code at their own risk.</br>
curiousapple is not responsible for the content or operation of any third-party websites or software linked or referenced in the review, and shall have no liability for the use of such.</br>
curiousapple is same as "Abhishek Vispute" in this context. </br> 
