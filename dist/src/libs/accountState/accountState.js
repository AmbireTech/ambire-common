"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountState = getAccountState;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccountState_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccountState.json"));
const deploy_1 = require("../../consts/deploy");
const _7702_1 = require("../7702/7702");
const account_1 = require("../account/account");
const deployless_1 = require("../deployless/deployless");
async function getAccountState(provider, network, accounts, blockTag = 'latest') {
    const deploylessAccountState = (0, deployless_1.fromDescriptor)(provider, AmbireAccountState_json_1.default, !network.rpcNoStateOverride);
    const args = accounts.map((account) => {
        const associatedKeys = network.erc4337.enabled && !account.associatedKeys.includes(deploy_1.ERC_4337_ENTRYPOINT)
            ? [...account.associatedKeys, deploy_1.ERC_4337_ENTRYPOINT]
            : account.associatedKeys;
        return [
            account.addr,
            associatedKeys,
            ...(account.creation == null
                ? ['0x0000000000000000000000000000000000000000', '0x']
                : (0, account_1.getAccountDeployParams)(account)),
            deploy_1.ERC_4337_ENTRYPOINT
        ];
    });
    async function getEOAsNonce(eoaAccounts) {
        const nonces = await Promise.all(eoaAccounts.map((addr) => provider.getTransactionCount(addr)));
        return Object.assign({}, ...eoaAccounts.map((addr, index) => ({
            [addr]: BigInt(nonces[index])
        })));
    }
    async function getEOAsCode(eoaAccounts) {
        const codes = await Promise.all(eoaAccounts.map((addr) => provider.getCode(addr)));
        return Object.assign({}, ...eoaAccounts.map((addr, index) => ({
            [addr]: codes[index]
        })));
    }
    const eoas = accounts.filter((account) => !(0, account_1.isSmartAccount)(account)).map((account) => account.addr);
    const [[accountStateResult], eoaNonces, eoaCodes] = await Promise.all([
        deploylessAccountState.call('getAccountsState', [args], {
            blockTag
        }),
        getEOAsNonce(eoas),
        getEOAsCode(eoas)
    ]);
    const result = accountStateResult.map((accResult, index) => {
        const associatedKeys = accResult.associatedKeyPrivileges.map((privilege, keyIndex) => {
            return [args[index][1][keyIndex], privilege];
        });
        const account = accounts[index];
        // an EOA is smarter if it either:
        // - has an active authorization
        // - has an active AMBIRE delegation
        const delegatedContract = eoaCodes[account.addr] && eoaCodes[account.addr].startsWith('0xef0100')
            ? `0x${eoaCodes[account.addr].substring(8)}`
            : null;
        const hasAmbireDelegation = eoaCodes[account.addr] === (0, ethers_1.concat)(['0xef0100', (0, _7702_1.getContractImplementation)(network.chainId)]);
        const isSmarterEoa = accResult.isEOA && hasAmbireDelegation;
        let delegatedContractName = null;
        if (delegatedContract) {
            if (delegatedContract.toLowerCase() === deploy_1.EIP_7702_AMBIRE_ACCOUNT.toLowerCase()) {
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
            associatedKeys: Object.fromEntries(associatedKeys),
            isV2: accResult.isV2,
            balance: accResult.balance,
            isEOA: accResult.isEOA,
            isErc4337Enabled: isSmarterEoa
                ? true
                : !!(network.erc4337.enabled &&
                    accResult.erc4337Nonce < deploy_1.MAX_UINT256 &&
                    associatedKeys.find((associatedKey) => associatedKey[0] === deploy_1.ERC_4337_ENTRYPOINT && associatedKey[1] === deploy_1.ENTRY_POINT_MARKER)),
            currentBlock: accResult.currentBlock,
            deployError: account.associatedKeys.length > 0 && accResult.associatedKeyPrivileges.length === 0,
            isSmarterEoa,
            delegatedContract,
            delegatedContractName
        };
    });
    return result;
}
//# sourceMappingURL=accountState.js.map