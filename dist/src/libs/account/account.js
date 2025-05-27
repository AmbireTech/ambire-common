"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultAccountPreferences = exports.getAccountImportStatus = exports.getDefaultSelectedAccount = exports.isDerivedForSmartAccountKeyOnly = exports.isSmartAccount = exports.isAmbireV1LinkedAccount = void 0;
exports.getAccountDeployParams = getAccountDeployParams;
exports.getBasicAccount = getBasicAccount;
exports.getSmartAccount = getSmartAccount;
exports.getSpoof = getSpoof;
exports.getEmailAccount = getEmailAccount;
exports.getUniqueAccountsArray = getUniqueAccountsArray;
exports.getAuthorization = getAuthorization;
exports.isBasicAccount = isBasicAccount;
exports.canBecomeSmarter = canBecomeSmarter;
exports.canBecomeSmarterOnChain = canBecomeSmarterOnChain;
exports.hasBecomeSmarter = hasBecomeSmarter;
exports.shouldUseStateOverrideForEOA = shouldUseStateOverrideForEOA;
const ethers_1 = require("ethers");
const account_1 = require("../../consts/account");
const deploy_1 = require("../../consts/deploy");
const derivation_1 = require("../../consts/derivation");
const signatures_1 = require("../../consts/signatures");
const account_2 = require("../../interfaces/account");
const _7702_1 = require("../7702/7702");
const recovery_1 = require("../dkim/recovery");
const bytecode_1 = require("../proxyDeploy/bytecode");
const getAmbireAddressTwo_1 = require("../proxyDeploy/getAmbireAddressTwo");
// returns to, data
function getAccountDeployParams(account) {
    // for EOAs, we do not throw an error anymore as we need fake
    // values for the simulation
    if (account.creation === null)
        return [ethers_1.ZeroAddress, '0x'];
    const factory = new ethers_1.Interface(['function deploy(bytes calldata code, uint256 salt) external']);
    return [
        account.creation.factoryAddr,
        factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
    ];
}
function getBasicAccount(addr, existingAccounts) {
    const { preferences } = existingAccounts.find((acc) => acc.addr === addr) || {};
    return {
        addr,
        associatedKeys: [addr],
        initialPrivileges: [],
        creation: null,
        preferences: {
            label: preferences?.label || account_1.DEFAULT_ACCOUNT_LABEL,
            pfp: preferences?.pfp || addr
        }
    };
}
async function getSmartAccount(privileges, existingAccounts) {
    const bytecode = await (0, bytecode_1.getBytecode)(privileges);
    const addr = (0, getAmbireAddressTwo_1.getAmbireAccountAddress)(deploy_1.AMBIRE_ACCOUNT_FACTORY, bytecode);
    const { preferences } = existingAccounts.find((acc) => acc.addr === addr) || {};
    return {
        addr,
        initialPrivileges: privileges.map((priv) => [priv.addr, priv.hash]),
        associatedKeys: privileges.map((priv) => priv.addr),
        creation: {
            factoryAddr: deploy_1.AMBIRE_ACCOUNT_FACTORY,
            bytecode,
            salt: (0, ethers_1.toBeHex)(0, 32)
        },
        preferences: {
            label: preferences?.label || account_1.DEFAULT_ACCOUNT_LABEL,
            pfp: preferences?.pfp || addr
        }
    };
}
function getSpoof(account) {
    const abiCoder = new ethers_1.AbiCoder();
    return abiCoder.encode(['address'], [account.associatedKeys[0]]) + signatures_1.SPOOF_SIGTYPE;
}
/**
 * Create a DKIM recoverable email smart account
 *
 * @param recoveryInfo DKIMRecoveryAccInfo
 * @param associatedKey the key that has privileges
 * @returns Promise<Account>
 */
async function getEmailAccount(recoveryInfo, associatedKey) {
    // const domain: string = recoveryInfo.emailFrom.split('@')[1]
    // TODO: make getEmailAccount work with cloudflare
    // try to take the dkimKey from the list of knownSelectors
    // if we cannot, we query a list of frequentlyUsedSelectors to try
    // to find the dkim key
    // let selector = knownSelectors[domain as keyof typeof knownSelectors] ?? ''
    // let dkimKey = selector ? await getPublicKeyIfAny({domain, selector: selector}) : ''
    // if (!dkimKey) {
    //   const promises = frequentlyUsedSelectors.map(sel => getPublicKeyIfAny({domain, selector: sel}))
    //   const results = await Promise.all(promises)
    //   for (let i = 0; i < results.length; i++) {
    //     if (results[i]) {
    //       dkimKey = results[i]
    //       selector = frequentlyUsedSelectors[i]
    //       break
    //     }
    //   }
    // }
    // if there's no dkimKey, standard DKIM recovery is not possible
    // we leave the defaults empty and the user will have to rely on
    // keys added through DNSSEC
    const selector = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(''));
    const modulus = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(''));
    const exponent = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(''));
    // if (dkimKey) {
    //   const key = publicKeyToComponents(dkimKey.publicKey)
    //   modulus = hexlify(key.modulus)
    //   exponent = hexlify(toBeHex(key.exponent))
    // }
    // acceptUnknownSelectors should be always true
    // and should not be overriden by the FE at this point
    const acceptUnknownSelectors = recovery_1.RECOVERY_DEFAULTS.acceptUnknownSelectors;
    const waitUntilAcceptAdded = recoveryInfo.waitUntilAcceptAdded ?? recovery_1.RECOVERY_DEFAULTS.waitUntilAcceptAdded;
    const waitUntilAcceptRemoved = recoveryInfo.waitUntilAcceptRemoved ?? recovery_1.RECOVERY_DEFAULTS.waitUntilAcceptRemoved;
    const acceptEmptyDKIMSig = recoveryInfo.acceptEmptyDKIMSig ?? recovery_1.RECOVERY_DEFAULTS.acceptEmptyDKIMSig;
    const acceptEmptySecondSig = recoveryInfo.acceptEmptySecondSig ?? recovery_1.RECOVERY_DEFAULTS.acceptEmptySecondSig;
    const onlyOneSigTimelock = recoveryInfo.onlyOneSigTimelock ?? recovery_1.RECOVERY_DEFAULTS.onlyOneSigTimelock;
    const abiCoder = new ethers_1.AbiCoder();
    const validatorAddr = recovery_1.DKIM_VALIDATOR_ADDR;
    const validatorData = abiCoder.encode(['tuple(string,string,string,bytes,bytes,address,bool,uint32,uint32,bool,bool,uint32)'], [
        [
            recoveryInfo.emailFrom,
            recovery_1.RECOVERY_DEFAULTS.emailTo,
            selector,
            modulus,
            exponent,
            recoveryInfo.secondaryKey,
            acceptUnknownSelectors,
            waitUntilAcceptAdded,
            waitUntilAcceptRemoved,
            acceptEmptyDKIMSig,
            acceptEmptySecondSig,
            onlyOneSigTimelock
        ]
    ]);
    const { hash } = (0, recovery_1.getSignerKey)(validatorAddr, validatorData);
    const privileges = [{ addr: associatedKey, hash }];
    return getSmartAccount(privileges, []);
}
const isAmbireV1LinkedAccount = (factoryAddr) => factoryAddr && (0, ethers_1.getAddress)(factoryAddr) === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA';
exports.isAmbireV1LinkedAccount = isAmbireV1LinkedAccount;
const isSmartAccount = (account) => !!account && !!account.creation;
exports.isSmartAccount = isSmartAccount;
/**
 * Checks if a (basic) EOA account is a derived one,
 * that is meant to be used as a smart account key only.
 */
const isDerivedForSmartAccountKeyOnly = (index) => typeof index === 'number' && index >= derivation_1.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET;
exports.isDerivedForSmartAccountKeyOnly = isDerivedForSmartAccountKeyOnly;
const getDefaultSelectedAccount = (accounts) => {
    if (accounts.length === 0)
        return null;
    const smartAccounts = accounts.filter((acc) => acc.creation);
    if (smartAccounts.length)
        return smartAccounts[0];
    return accounts[0];
};
exports.getDefaultSelectedAccount = getDefaultSelectedAccount;
const getAccountImportStatus = ({ account, alreadyImportedAccounts, keys, accountsOnPage = [], keyIteratorType }) => {
    const isAlreadyImported = alreadyImportedAccounts.some(({ addr }) => addr === account.addr);
    if (!isAlreadyImported)
        return account_2.ImportStatus.NotImported;
    // Check if the account has been imported with at least one of the keys
    // that the account was originally associated with, when it was imported.
    const storedAssociatedKeys = alreadyImportedAccounts.find((x) => x.addr === account.addr)?.associatedKeys || [];
    const importedKeysForThisAcc = keys.filter((key) => storedAssociatedKeys.includes(key.addr));
    // Could be imported as a view only account (and therefore, without a key)
    if (!importedKeysForThisAcc.length)
        return account_2.ImportStatus.ImportedWithoutKey;
    // Merge the `associatedKeys` from the account instances found on the page,
    // with the `associatedKeys` of the account from the extension storage. This
    // ensures up-to-date keys, considering the account existing associatedKeys
    // could be outdated  (associated keys of the smart accounts can change) or
    // incomplete initial data (during the initial import, not all associatedKeys
    // could have been fetched (for privacy).
    const mergedAssociatedKeys = Array.from(new Set([
        ...accountsOnPage
            .filter((x) => x.account.addr === account.addr)
            .flatMap((x) => x.account.associatedKeys),
        ...storedAssociatedKeys
    ]));
    // Same key in this context means not only the same key address, but the
    // same type too. Because user can opt in to import same key address with
    // many different hardware wallets (Trezor, Ledger, GridPlus, etc.) or
    // the same address with seed (private key).
    const associatedKeysAlreadyImported = importedKeysForThisAcc.filter((key) => mergedAssociatedKeys.includes(key.addr) &&
        // if key type is not provided, skip this part of the check on purpose
        (keyIteratorType ? key.type === keyIteratorType : true));
    if (associatedKeysAlreadyImported.length) {
        const associatedKeysNotImportedYet = mergedAssociatedKeys.filter((keyAddr) => associatedKeysAlreadyImported.some((x) => x.addr !== keyAddr));
        const notImportedYetKeysExistInPage = accountsOnPage.some((x) => associatedKeysNotImportedYet.includes(x.account.addr));
        if (notImportedYetKeysExistInPage)
            return account_2.ImportStatus.ImportedWithSomeOfTheKeys;
        // Could happen when user imports a smart account with one associated key.
        // Then imports an EOA. Then makes the EOA a second key
        // for the smart account. In this case, both associated keys of the smart
        // account are imported, but the smart account's `associatedKeys` are incomplete.
        const associatedKeysFoundOnPageAreDifferent = accountsOnPage
            .filter((x) => x.account.addr === account.addr)
            .some((x) => {
            const incomingAssociatedKeysSet = new Set(x.account.associatedKeys);
            const storedAssociatedKeysSet = new Set(storedAssociatedKeys);
            return ![...incomingAssociatedKeysSet].every((k) => storedAssociatedKeysSet.has(k));
        });
        return associatedKeysFoundOnPageAreDifferent
            ? account_2.ImportStatus.ImportedWithSomeOfTheKeys
            : account_2.ImportStatus.ImportedWithTheSameKeys;
    }
    // Since there are `importedKeysForThisAcc`, as a fallback -
    // for all other scenarios this account has been imported with different keys.
    return account_2.ImportStatus.ImportedWithDifferentKeys;
};
exports.getAccountImportStatus = getAccountImportStatus;
const getDefaultAccountPreferences = (accountAddr, prevAccounts, i) => {
    const number = i ? prevAccounts.length + (i + 1) : prevAccounts.length + 1;
    return {
        label: `Account ${number}`,
        pfp: (0, ethers_1.getAddress)(accountAddr) // default pfp - a jazz icon generated from the addr
    };
};
exports.getDefaultAccountPreferences = getDefaultAccountPreferences;
function getUniqueAccountsArray(accounts) {
    return Array.from(new Map(accounts.map((account) => [account.addr, account])).values());
}
function getAuthorization(account, 
// make sure to pass the EOA nonce here, not the SA or entry point
eoaNonce, network, authorizations) {
    if (account.creation || !authorizations[account.addr])
        return undefined;
    return authorizations[account.addr].find((msg) => {
        const content = msg.content;
        return ((content.chainId === 0n || content.chainId === network.chainId) &&
            content.nonce === eoaNonce &&
            (0, _7702_1.getContractImplementation)(content.chainId) === content.contractAddr);
    });
}
// use this in cases where you strictly want to enable/disable an action for
// EOAs (excluding smart and smarter)
function isBasicAccount(account, state) {
    return !account.creation && !state.isSmarterEoa;
}
// can the account as a whole become smarter (disregarding chain and state)
function canBecomeSmarter(acc, accKeys) {
    return !(0, exports.isSmartAccount)(acc) && !!accKeys.find((key) => key.type === 'internal');
}
// can the account become smarter on a specific chain
function canBecomeSmarterOnChain(network, acc, state, accKeys) {
    return ((0, _7702_1.has7702)(network) &&
        isBasicAccount(acc, state) &&
        !!accKeys.find((key) => key.type === 'internal'));
}
function hasBecomeSmarter(account, state) {
    if (!state[account.addr])
        return false;
    const networks = Object.keys(state[account.addr]);
    for (let i = 0; i < networks.length; i++) {
        const onChainState = state[account.addr][networks[i]];
        // eslint-disable-next-line no-continue
        if (!onChainState)
            continue;
        if (onChainState.isSmarterEoa)
            return true;
    }
    return false;
}
function shouldUseStateOverrideForEOA(account, state) {
    return isBasicAccount(account, state);
}
//# sourceMappingURL=account.js.map