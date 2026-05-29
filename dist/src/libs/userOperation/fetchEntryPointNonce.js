"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchNonce = fetchNonce;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const EntryPoint_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/EntryPoint.json"));
const deploy_1 = require("../../consts/deploy");
async function fetchNonce(account, provider) {
    const epInterface = new ethers_1.Interface(EntryPoint_json_1.default);
    const failure = () => {
        console.error('unable to fetch the entry point nonce, estimateBundler');
        return null;
    };
    const [accountNonceHexLatest, accountNonceHexPending] = await Promise.all([
        provider
            .call({
            to: deploy_1.ERC_4337_ENTRYPOINT,
            data: epInterface.encodeFunctionData('getNonce', [account.addr, 0]),
            blockTag: 'latest'
        })
            .catch(failure),
        provider
            .call({
            to: deploy_1.ERC_4337_ENTRYPOINT,
            data: epInterface.encodeFunctionData('getNonce', [account.addr, 0]),
            blockTag: 'pending'
        })
            .catch(failure)
    ]);
    // if there's an RPC problem and we can't fetch the nonce, we return an error
    if (accountNonceHexLatest === null && accountNonceHexPending === null)
        return null;
    if (accountNonceHexLatest === null)
        return BigInt(accountNonceHexPending); // shouldn't happen
    if (accountNonceHexPending === null)
        return BigInt(accountNonceHexLatest);
    const accountNonceLatest = BigInt(accountNonceHexLatest);
    const accountNoncePending = BigInt(accountNonceHexPending);
    // always trust latest except the time when pending is higher
    return accountNoncePending > accountNonceLatest ? accountNoncePending : accountNonceLatest;
}
//# sourceMappingURL=fetchEntryPointNonce.js.map