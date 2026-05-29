"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PERMIT2_ADDRESS_LOWERCASED = void 0;
exports.isPermit2Interaction = isPermit2Interaction;
const ethers_1 = require("ethers");
exports.PERMIT2_ADDRESS_LOWERCASED = '0x000000000022D473030F116dDEE9F6B43aC78BA3'.toLowerCase();
const APPROVE_SELECTOR = '0x095ea7b3';
/**
 * Extract spender if call is `approve(address spender, uint amount)`
 */
function extractSpenderFromApprove(data) {
    if (!data || !data.startsWith(APPROVE_SELECTOR))
        return null;
    try {
        const slot = (0, ethers_1.dataSlice)(data, 4, 36); // 32-byte slot for spender
        const spenderHex = `0x${slot.slice(-40)}`; // keep last 20 bytes
        return (0, ethers_1.getAddress)(spenderHex);
    }
    catch {
        return null;
    }
}
/**
 * Detects if a call is interacting with Permit2
 */
function isPermit2Interaction(call) {
    if (!call?.to || !call?.data)
        return false;
    const selector = call.data.slice(0, 10).toLowerCase();
    // Case 1: direct call to Permit2
    if (call.to.toLowerCase() === exports.PERMIT2_ADDRESS_LOWERCASED) {
        return true;
    }
    // Case 2: approve on ERC-20 where spender is Permit2
    if (selector === APPROVE_SELECTOR) {
        const spender = extractSpenderFromApprove(call.data);
        if (spender?.toLowerCase() === exports.PERMIT2_ADDRESS_LOWERCASED) {
            return true;
        }
    }
    return false;
}
//# sourceMappingURL=detectPermit2Interaction.js.map