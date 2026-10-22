"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BaseAccount = void 0;
/* eslint-disable @typescript-eslint/no-unused-vars */
const networks_1 = require("../../consts/networks");
const broadcast_1 = require("../broadcast/broadcast");
class BaseAccount {
    account;
    network;
    accountState;
    isErc4337Enabled;
    // when doing the 7702 activator/revoke, we should add the additional gas required
    // for the authorization list:
    // PER_EMPTY_ACCOUNT_COST: 25000
    // access list storage key: 1900
    // access list address: 2400
    ACTIVATOR_GAS_USED = 29300n;
    constructor(account, network, accountState, isErc4337Enabled) {
        this.account = account;
        this.network = network;
        this.accountState = accountState;
        this.isErc4337Enabled = isErc4337Enabled;
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
    canUseErc4337() {
        return false;
    }
    /**
     * When ERC-4337 is disabled, the RPC is the only source of gas prices.
     * On Ethereum, the gas prices returned by the bundlers differ from the RPC ones,
     * so the RPC is given priority: accounts that cannot use ERC-4337 rely on the RPC
     * only, while the ones that can use the RPC with the bundler as a fallback for
     * their broadcasts outside the bundler (see shouldUseRpcGasPrices).
     * Everywhere else, the bundler is preferred as it's faster and more accurate
     */
    getGasPriceFetchStrategy(isErc4337Enabled) {
        // global config
        if (!isErc4337Enabled)
            return 'rpc';
        // bundler is with priority on other chains
        if (this.network.chainId !== networks_1.ETHEREUM_CHAIN_ID)
            return 'bundlerWithRpcFallback';
        // rpc is with priority on Ethereum
        return this.canUseErc4337() ? 'rpcWithBundlerFallback' : 'rpc';
    }
    /**
     * When the account uses the `rpcWithBundlerFallback` strategy (see getGasPriceFetchStrategy),
     * a bundler broadcast (the account itself paying in a token or native via userOp)
     * should use the bundler gas prices and every other broadcast (by self,
     * by another EOA, by the relayer) - the RPC ones
     */
    shouldUseRpcGasPrices(broadcastOption) {
        return broadcastOption !== broadcast_1.BROADCAST_OPTIONS.byBundler;
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