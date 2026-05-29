"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountState = getAccountState;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccountState_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccountState.json"));
const ProviderError_1 = require("../../classes/ProviderError");
const _7702_1 = require("../../consts/7702");
const deploy_1 = require("../../consts/deploy");
const getBlockTag_1 = require("../../utils/getBlockTag");
const _7702_2 = require("../7702/7702");
const account_1 = require("../account/account");
const deployless_1 = require("../deployless/deployless");
const hasAmbireDelegation = (code) => {
    if (!code)
        return false;
    let hasCode = false;
    for (let i = 0; i < _7702_1.eip7702AmbireContracts.length; i++) {
        hasCode = code === (0, ethers_1.concat)(['0xef0100', _7702_1.eip7702AmbireContracts[i]]);
        if (hasCode)
            break;
    }
    return hasCode;
};
async function getAccountState(provider, network, accounts, keys, blockTag = 'latest') {
    const deploylessAccountState = (0, deployless_1.fromDescriptor)(provider, AmbireAccountState_json_1.default, !network.rpcNoStateOverride);
    const args = accounts.map((account) => {
        const associatedKeys = !account.associatedKeys.includes(deploy_1.ERC_4337_ENTRYPOINT)
            ? [...account.associatedKeys, deploy_1.ERC_4337_ENTRYPOINT]
            : account.associatedKeys;
        return [
            account.addr,
            associatedKeys,
            ...(account.creation == null
                ? ['0x0000000000000000000000000000000000000000', '0x']
                : (0, account_1.getAccountDeployParams)(account)),
            deploy_1.ERC_4337_ENTRYPOINT,
            !!account.safeCreation
        ];
    });
    async function getEOAsNonce(eoaAccounts) {
        const nonces = await Promise.all(eoaAccounts.map((addr) => provider.getTransactionCount(addr)));
        return Object.assign({}, ...eoaAccounts.map((addr, index) => ({
            [addr]: BigInt(nonces[index])
        })));
    }
    async function getEOAsCode(eoaAccounts) {
        // if the network doesn't support 7702, don't search for codes on it
        if (!(0, _7702_2.has7702)(network)) {
            return Object.assign({}, ...eoaAccounts.map((addr) => ({
                [addr]: null
            })));
        }
        const codes = await Promise.all(eoaAccounts.map((addr) => provider.getCode(addr)));
        return Object.assign({}, ...eoaAccounts.map((addr, index) => ({
            [addr]: codes[index]
        })));
    }
    const eoas = accounts.filter((account) => !(0, account_1.isSmartAccount)(account)).map((account) => account.addr);
    const [accountStateResult, eoaNonces, eoaCodes] = await Promise.all([
        deploylessAccountState.call('getAccountsState', [args], {
            blockTag: blockTag === 'pending' ? (0, getBlockTag_1.getPendingBlockTagIfSupported)(network) : blockTag
        }),
        getEOAsNonce(eoas).catch((e) => {
            throw new ProviderError_1.ProviderError({ originalError: e, providerUrl: provider._getConnection()?.url });
        }),
        getEOAsCode(eoas).catch((e) => {
            throw new ProviderError_1.ProviderError({ originalError: e, providerUrl: provider._getConnection()?.url });
        })
    ]);
    const result = accountStateResult.map((accResult, index) => {
        const account = accounts[index];
        const associatedKeys = accResult.associatedKeys.filter((k) => k !== deploy_1.ERC_4337_ENTRYPOINT);
        // an EOA is smarter if it either:
        // - has an active authorization
        // - has an active AMBIRE delegation
        const delegatedContract = eoaCodes[account.addr] && eoaCodes[account.addr].startsWith('0xef0100')
            ? `0x${eoaCodes[account.addr].substring(8)}`
            : null;
        const isSmarterEoa = accResult.isEOA && hasAmbireDelegation(eoaCodes[account.addr]);
        let delegatedContractName = null;
        if (delegatedContract) {
            if (_7702_1.eip7702AmbireContracts
                .map((c) => c.toLowerCase())
                .indexOf(delegatedContract.toLowerCase()) !== -1) {
                delegatedContractName = 'AMBIRE';
            }
            else if (delegatedContract.toLowerCase() === deploy_1.EIP_7702_METAMASK.toLowerCase()) {
                delegatedContractName = 'METAMASK';
            }
            else {
                delegatedContractName = 'UNKNOWN';
            }
        }
        return {
            accountAddr: account.addr,
            eoaNonce: accResult.isEOA ? eoaNonces[account.addr] : null,
            nonce: !(0, account_1.isSmartAccount)(account) && !isSmarterEoa ? eoaNonces[account.addr] : accResult.nonce,
            erc4337Nonce: accResult.erc4337Nonce,
            isDeployed: accResult.isDeployed,
            associatedKeys,
            importedAccountKeys: keys.filter((key) => associatedKeys.includes(key.addr)),
            isV2: accResult.isV2,
            balance: accResult.balance,
            isEOA: accResult.isEOA,
            isErc4337Enabled: accResult.isErc4337Enabled,
            currentBlock: accResult.currentBlock,
            isSmarterEoa,
            delegatedContract,
            delegatedContractName,
            threshold: Number(accResult.threshold),
            updatedAt: Date.now()
        };
    });
    return result;
}
//# sourceMappingURL=accountState.js.map