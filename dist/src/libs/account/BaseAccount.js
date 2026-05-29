"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAccount = void 0;
class BaseAccount {
    account;
    network;
    accountState;
    constructor(account, network, accountState) {
        this.account = account;
        this.network = network;
        this.accountState = accountState;
    }
    getAccount() {
        return this.account;
    }
    // this is specific for v2 accounts, hardcoding a false for all else
    shouldIncludeActivatorCall(paidBy) {
        return false;
    }
    // this is specific for eoa7702 accounts
    shouldSignAuthorization(broadcastOption) {
        return false;
    }
    // valid only EOAs in very specific circumstances
    shouldBroadcastCallsSeparately(op) {
        return false;
    }
    // describe the state override needed during bundler estimation if any
    getBundlerStateOverride(userOp) {
        return undefined;
    }
    // this is specific for v2 accounts
    shouldSignDeployAuth(broadcastOption) {
        return false;
    }
    isSponsorable() {
        return false;
    }
    /**
     * Do we allow the account to broadcast by itself
     */
    canBroadcastByItself() {
        return true;
    }
    /**
     * Get the broadcast nonce for each account if special conditions
     * for its fetch should apply
     */
    async getBroadcastNonce(activity, op, provider) {
        return op.nonce;
    }
}
exports.BaseAccount = BaseAccount;
//# sourceMappingURL=BaseAccount.js.map