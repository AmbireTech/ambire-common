"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ApplicationType = exports.SupportedWeb3Connectivity = exports.WalletConnectionType = void 0;
var WalletConnectionType;
(function (WalletConnectionType) {
    WalletConnectionType["gnosis"] = "gnosis";
    WalletConnectionType["walletconnect"] = "walletconnect";
})(WalletConnectionType || (exports.WalletConnectionType = WalletConnectionType = {}));
var SupportedWeb3Connectivity;
(function (SupportedWeb3Connectivity) {
    SupportedWeb3Connectivity["gnosis"] = "gnosis";
    SupportedWeb3Connectivity["walletconnect"] = "walletconnect";
    SupportedWeb3Connectivity["injected"] = "injected";
})(SupportedWeb3Connectivity || (exports.SupportedWeb3Connectivity = SupportedWeb3Connectivity = {}));
var ApplicationType;
(function (ApplicationType) {
    ApplicationType["web"] = "web";
    ApplicationType["mobile"] = "mobile";
})(ApplicationType || (exports.ApplicationType = ApplicationType = {}));
//# sourceMappingURL=types.js.map