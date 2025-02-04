export var ErrorType;
(function (ErrorType) {
    /** Reference, Type, Syntax and Range errors (JS/TS) */
    ErrorType["CodeError"] = "CodeError";
    /** Error due to contract reverting, identified by prefix 0x08c379a0 */
    ErrorType["RevertError"] = "RevertError";
    /** Error due to contract panic, identified by prefix 0x4e487b71 */
    ErrorType["PanicError"] = "PanicError";
    /** Error originating from a relayer call */
    ErrorType["RelayerError"] = "RelayerError";
    /** Error originating from the Paymaster (our Relayer) */
    ErrorType["PaymasterError"] = "PaymasterError";
    /** Error during bundler estimation or broadcast */
    ErrorType["BundlerError"] = "BundlerError";
    /** Custom contract errors */
    ErrorType["CustomError"] = "CustomError";
    /** Error from an RPC call */
    ErrorType["RpcError"] = "RpcError";
    /** Error that cannot be decoded */
    ErrorType["UnknownError"] = "UnknownError";
    /** Error due to the user rejecting a transaction */
    ErrorType["UserRejectionError"] = "UserRejectionError";
    /** Error due to an inner call failure during estimation */
    ErrorType["InnerCallFailureError"] = "InnerCallFailureError";
})(ErrorType || (ErrorType = {}));
//# sourceMappingURL=types.js.map