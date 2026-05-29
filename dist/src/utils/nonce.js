"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRelayerNonce = getRelayerNonce;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../contracts/compiled/AmbireAccount.json"));
const types_1 = require("../libs/accountOp/types");
async function getRelayerNonce(activity, op, provider) {
    // find the pending activity with the biggest nonce
    const accountBroadcastedButNotConfirmed = activity.broadcastedButNotConfirmed[op.accountAddr] || [];
    const pendingActivityOps = accountBroadcastedButNotConfirmed.filter((accOp) => accOp.chainId === op.chainId);
    const pendingActivityOp = pendingActivityOps.length
        ? pendingActivityOps.reduce((prev, current) => (current.nonce > prev.nonce ? current : prev))
        : null;
    if (!pendingActivityOp || (op.nonce && pendingActivityOp.nonce < op.nonce))
        return op.nonce;
    const ambireInterface = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    const pendingAccountNonce = await provider
        .send('eth_call', [
        {
            to: op.accountAddr,
            data: ambireInterface.encodeFunctionData('nonce')
        },
        'pending'
    ])
        .catch(null);
    if (pendingAccountNonce && BigInt(pendingAccountNonce) > pendingActivityOp.nonce)
        return BigInt(pendingAccountNonce);
    // if there's a failure in the last 5 txns
    // get the failure and check if we have a confirmed txn after
    // if we don't, the latest nonce should be equal to the failed one
    const lastFiveTxns = activity.getAccountOpsForAccount({ from: 0, numberOfItems: 5 });
    const failure = lastFiveTxns.find((subOp) => subOp.status === types_1.AccountOpStatus.Failure);
    if (!failure)
        return pendingActivityOp.nonce + 1n;
    // failed in the last 5, check if we have replayed the nonce
    // and if we haven't, replay it
    const failedNonce = failure.nonce;
    const sameNonceBroadcast = lastFiveTxns.filter((subOp) => subOp.nonce === failedNonce && subOp.status !== types_1.AccountOpStatus.Failure);
    if (!sameNonceBroadcast.length)
        return failedNonce;
    // just go +1
    return pendingActivityOp.nonce + 1n;
}
//# sourceMappingURL=nonce.js.map