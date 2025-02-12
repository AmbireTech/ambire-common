"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountState = void 0;
const tslib_1 = require("tslib");
const AmbireAccountState_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccountState.json"));
const deploy_1 = require("../../consts/deploy");
const account_1 = require("../account/account");
const deployless_1 = require("../deployless/deployless");
async function getAccountState(provider, network, accounts, blockTag = 'latest') {
    const deploylessAccountState = (0, deployless_1.fromDescriptor)(provider, AmbireAccountState_json_1.default, !network.rpcNoStateOverride);
    const args = accounts.map((account) => {
        const associatedKeys = network?.erc4337?.enabled && !account.associatedKeys.includes(deploy_1.ERC_4337_ENTRYPOINT)
            ? [...account.associatedKeys, deploy_1.ERC_4337_ENTRYPOINT]
            : account.associatedKeys;
        return [
            account.addr,
            associatedKeys,
            ...(account.creation == null
                ? ['0x0000000000000000000000000000000000000000', '0x']
                : (0, account_1.getAccountDeployParams)(account)),
            network?.erc4337?.enabled ? deploy_1.ERC_4337_ENTRYPOINT : '0x0000000000000000000000000000000000000000'
        ];
    });
    async function getEOAsNonce(eoaAccounts) {
        const nonces = await Promise.all(eoaAccounts.map((addr) => provider.getTransactionCount(addr)));
        return Object.assign({}, ...eoaAccounts.map((addr, index) => ({
            [addr]: BigInt(nonces[index])
        })));
    }
    const [[accountStateResult], eoaNonces] = await Promise.all([
        deploylessAccountState.call('getAccountsState', [args], {
            blockTag
        }),
        getEOAsNonce(accounts.filter((account) => !(0, account_1.isSmartAccount)(account)).map((account) => account.addr))
    ]);
    const result = accountStateResult.map((accResult, index) => {
        const associatedKeys = accResult.associatedKeyPrivileges.map((privilege, keyIndex) => {
            return [args[index][1][keyIndex], privilege];
        });
        const res = {
            accountAddr: accounts[index].addr,
            nonce: !(0, account_1.isSmartAccount)(accounts[index]) ? eoaNonces[accounts[index].addr] : accResult.nonce,
            erc4337Nonce: accResult.erc4337Nonce,
            isDeployed: accResult.isDeployed,
            associatedKeys: Object.fromEntries(associatedKeys),
            isV2: accResult.isV2,
            balance: accResult.balance,
            isEOA: accResult.isEOA,
            isErc4337Enabled: !!(network?.erc4337?.enabled &&
                accResult.erc4337Nonce < deploy_1.MAX_UINT256 &&
                associatedKeys.find((associatedKey) => associatedKey[0] === deploy_1.ERC_4337_ENTRYPOINT && associatedKey[1] === deploy_1.ENTRY_POINT_MARKER)),
            currentBlock: accResult.currentBlock,
            deployError: accounts[index].associatedKeys.length > 0 && accResult.associatedKeyPrivileges.length === 0
        };
        return res;
    });
    return result;
}
exports.getAccountState = getAccountState;
//# sourceMappingURL=accountState.js.map