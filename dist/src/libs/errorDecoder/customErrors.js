"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SponsorshipPaymasterError = exports.RelayerPaymasterError = exports.InnerCallFailureError = exports.BundlerError = void 0;
const ethers_1 = require("ethers");
class InnerCallFailureError extends Error {
    data = '';
    calls;
    nativePortfolioValue;
    network;
    constructor(message, calls, network, nativePortfolioValue) {
        super(message);
        this.name = 'InnerCallFailureError';
        this.calls = calls;
        this.network = network;
        this.nativePortfolioValue = nativePortfolioValue;
        // If the message is a hex string pass it to
        // the data field so it can be used by other error handlers
        if ((0, ethers_1.isHexString)(message)) {
            this.data = message;
        }
    }
}
exports.InnerCallFailureError = InnerCallFailureError;
class RelayerPaymasterError extends Error {
    isHumanized;
    constructor(error) {
        super(error.message);
        this.name = 'PaymasterError';
        this.message = error.message;
        this.isHumanized = error.isHumanized || false;
    }
}
exports.RelayerPaymasterError = RelayerPaymasterError;
class SponsorshipPaymasterError extends Error {
    isHumanized = false;
    constructor() {
        const message = 'Sponsorship failed.';
        super(message);
        this.name = 'PaymasterSponsorshipError';
        this.message = message;
    }
}
exports.SponsorshipPaymasterError = SponsorshipPaymasterError;
class BundlerError extends Error {
    bundlerName;
    constructor(message, bundlerName) {
        super(message);
        this.bundlerName = bundlerName;
        this.name = 'BundlerError';
        this.message = message;
    }
}
exports.BundlerError = BundlerError;
//# sourceMappingURL=customErrors.js.map