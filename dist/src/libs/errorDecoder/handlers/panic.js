"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable class-methods-use-this */
const ethers_1 = require("ethers");
const constants_1 = require("../constants");
const helpers_1 = require("../helpers");
const types_1 = require("../types");
class PanicErrorHandler {
    matches(data) {
        return data?.startsWith(constants_1.PANIC_ERROR_PREFIX);
    }
    handle(data) {
        const encodedReason = data.slice(constants_1.PANIC_ERROR_PREFIX.length);
        const abi = new ethers_1.AbiCoder();
        try {
            const fragment = ethers_1.ErrorFragment.from('Panic(uint256)');
            const args = abi.decode(fragment.inputs, `0x${encodedReason}`);
            const reason = (0, helpers_1.panicErrorCodeToReason)(args[0]) ?? 'Unknown panic code';
            return {
                type: types_1.ErrorType.PanicError,
                reason,
                data
            };
        }
        catch (e) {
            console.error('Failed to decode panic error', e);
            return {
                type: types_1.ErrorType.PanicError,
                reason: 'Failed to decode panic error',
                data
            };
        }
    }
}
exports.default = PanicErrorHandler;
//# sourceMappingURL=panic.js.map