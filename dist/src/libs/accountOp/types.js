"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AccountOpStatus = void 0;
var AccountOpStatus;
(function (AccountOpStatus) {
    AccountOpStatus["Pending"] = "pending";
    AccountOpStatus["BroadcastedButNotConfirmed"] = "broadcasted-but-not-confirmed";
    AccountOpStatus["Success"] = "success";
    AccountOpStatus["Failure"] = "failure";
    AccountOpStatus["Rejected"] = "rejected";
    AccountOpStatus["UnknownButPastNonce"] = "unknown-but-past-nonce";
    AccountOpStatus["BroadcastButStuck"] = "broadcast-but-stuck";
})(AccountOpStatus || (exports.AccountOpStatus = AccountOpStatus = {}));
//# sourceMappingURL=types.js.map