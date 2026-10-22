"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TraceCallDiscoveryStatus = exports.noStateUpdateStatuses = exports.FeeSpeed = exports.SigningStatus = void 0;
var SigningStatus;
(function (SigningStatus) {
    SigningStatus["EstimationError"] = "estimation-error";
    SigningStatus["UnableToSign"] = "unable-to-sign";
    SigningStatus["ReadyToSign"] = "ready-to-sign";
    /**
     * Used to prevent state updates while the user is resolving warnings, connecting a hardware wallet, etc.
     * Signing is allowed in this state, but the state of the controller should not change.
     */
    SigningStatus["UpdatesPaused"] = "updates-paused";
    SigningStatus["InProgress"] = "in-progress";
    SigningStatus["WaitingForPaymaster"] = "waiting-for-paymaster-response";
    SigningStatus["Done"] = "done";
    SigningStatus["Queued"] = "queued";
    SigningStatus["SafeQuickBroadcastBundler"] = "safe-quick-broadcast-bundler";
    /**
     * The pending transaction that is being sped up was processed before the speed up was
     * signed, so its place (nonce) is taken and the speed up can't go through anymore.
     * Final, nothing can be signed in this state.
     */
    SigningStatus["SpeedUpNotNeeded"] = "speed-up-not-needed";
})(SigningStatus || (exports.SigningStatus = SigningStatus = {}));
var FeeSpeed;
(function (FeeSpeed) {
    FeeSpeed["Slow"] = "slow";
    FeeSpeed["Medium"] = "medium";
    FeeSpeed["Fast"] = "fast";
    FeeSpeed["Ape"] = "ape";
})(FeeSpeed || (exports.FeeSpeed = FeeSpeed = {}));
exports.noStateUpdateStatuses = [
    SigningStatus.InProgress,
    SigningStatus.Done,
    SigningStatus.UpdatesPaused,
    SigningStatus.WaitingForPaymaster,
    SigningStatus.SafeQuickBroadcastBundler,
    SigningStatus.SpeedUpNotNeeded
];
var TraceCallDiscoveryStatus;
(function (TraceCallDiscoveryStatus) {
    TraceCallDiscoveryStatus["NotStarted"] = "not-started";
    TraceCallDiscoveryStatus["InProgress"] = "in-progress";
    TraceCallDiscoveryStatus["Done"] = "done";
    TraceCallDiscoveryStatus["Failed"] = "failed";
})(TraceCallDiscoveryStatus || (exports.TraceCallDiscoveryStatus = TraceCallDiscoveryStatus = {}));
//# sourceMappingURL=signAccountOp.js.map