"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable class-methods-use-this */
const ethers_1 = require("ethers");
const constants_1 = require("../constants");
const types_1 = require("../types");
class RevertErrorHandler {
    matches(data) {
        return data?.startsWith(constants_1.ERROR_PREFIX);
    }
    handle(data) {
        const encodedReason = data.slice(constants_1.ERROR_PREFIX.length);
        const abi = new ethers_1.AbiCoder();
        try {
            const fragment = ethers_1.ErrorFragment.from('Error(string)');
            const args = abi.decode(fragment.inputs, `0x${encodedReason}`);
            const reason = args[0];
            return {
                type: types_1.ErrorType.RevertError,
                reason,
                data
            };
        }
        catch (e) {
            console.error('Failed to decode revert error', e);
            return {
                type: types_1.ErrorType.RevertError,
                reason: '',
                data
            };
        }
    }
}
exports.default = RevertErrorHandler;
//# sourceMappingURL=revert.js.map