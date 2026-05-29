export var AccountOpStatus;
(function (AccountOpStatus) {
    AccountOpStatus["Pending"] = "pending";
    AccountOpStatus["BroadcastedButNotConfirmed"] = "broadcasted-but-not-confirmed";
    AccountOpStatus["Success"] = "success";
    AccountOpStatus["Failure"] = "failure";
    AccountOpStatus["Rejected"] = "rejected";
    AccountOpStatus["UnknownButPastNonce"] = "unknown-but-past-nonce";
    AccountOpStatus["BroadcastButStuck"] = "broadcast-but-stuck";
    // use this status as representational in activity/history
    // only for non-atomic batches that have incompleted transactions
    AccountOpStatus["PartiallyComplete"] = "partially-complete";
})(AccountOpStatus || (AccountOpStatus = {}));
//# sourceMappingURL=types.js.map