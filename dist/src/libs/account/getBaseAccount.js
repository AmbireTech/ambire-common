"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBaseAccount = getBaseAccount;
const account_1 = require("./account");
const EOA_1 = require("./EOA");
const EOA7702_1 = require("./EOA7702");
const V1_1 = require("./V1");
const V2_1 = require("./V2");
function getBaseAccount(account, accountState, accountKeys, network) {
    if (accountState.isEOA) {
        if (accountState.isSmarterEoa ||
            (0, account_1.canBecomeSmarterOnChain)(network, account, accountState, accountKeys)) {
            return new EOA7702_1.EOA7702(account, network, accountState);
        }
        return new EOA_1.EOA(account, network, accountState);
    }
    return accountState.isV2
        ? new V2_1.V2(account, network, accountState)
        : new V1_1.V1(account, network, accountState);
}
//# sourceMappingURL=getBaseAccount.js.map