"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBaseAccount = getBaseAccount;
const account_1 = require("./account");
const EOA_1 = require("./EOA");
const EOA7702_1 = require("./EOA7702");
const Safe_1 = require("./Safe");
const V1_1 = require("./V1");
const V2_1 = require("./V2");
function getBaseAccount(account, accountState, network, isErc4337Enabled, isErc7702Enabled) {
    if (account.safeCreation)
        return new Safe_1.Safe(account, network, accountState, isErc4337Enabled);
    if (accountState.isEOA) {
        // an account that is already upgraded onchain always behaves as one. The
        // rest are upgraded on their own only if their keys allow it, see
        // shouldBecomeSmarterAutomatically
        const shouldBeSmarter = accountState.isSmarterEoa ||
            ((0, account_1.canBecomeSmarterOnChain)(network, account, accountState) &&
                (0, account_1.shouldBecomeSmarterAutomatically)(accountState.importedAccountKeys));
        if (isErc7702Enabled && shouldBeSmarter) {
            return new EOA7702_1.EOA7702(account, network, accountState, isErc4337Enabled);
        }
        return new EOA_1.EOA(account, network, accountState, isErc4337Enabled);
    }
    return accountState.isV2
        ? new V2_1.V2(account, network, accountState, isErc4337Enabled)
        : new V1_1.V1(account, network, accountState, isErc4337Enabled);
}
//# sourceMappingURL=getBaseAccount.js.map