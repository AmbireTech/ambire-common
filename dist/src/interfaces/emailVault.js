"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OperationRequestType = exports.SecretType = void 0;
var SecretType;
(function (SecretType) {
    SecretType["RecoveryKey"] = "recoveryKey";
    SecretType["KeyStore"] = "keyStore";
    SecretType["keyBackup"] = "keyBackup";
})(SecretType || (exports.SecretType = SecretType = {}));
var OperationRequestType;
(function (OperationRequestType) {
    OperationRequestType["requestKeySync"] = "requestKeySync";
})(OperationRequestType || (exports.OperationRequestType = OperationRequestType = {}));
//# sourceMappingURL=emailVault.js.map