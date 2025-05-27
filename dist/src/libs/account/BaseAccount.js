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
    shouldIncludeActivatorCall(broadcastOption) {
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
}
exports.BaseAccount = BaseAccount;
//# sourceMappingURL=BaseAccount.js.map