"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodePrivacyPoolsDeposit = exports.readPrivacyPoolsDeposit = exports.ENTRYPOINT_DEPOSIT_INTERFACE = exports.ERC20_DEPOSIT_SIGNATURE = exports.NATIVE_DEPOSIT_SIGNATURE = void 0;
const ethers_1 = require("ethers");
const privacyPools_1 = require("../../consts/privacyPools");
const constants_1 = require("../../services/socket/constants");
/** The entrypoint's native deposit, which carries the amount as the call's value. */
exports.NATIVE_DEPOSIT_SIGNATURE = 'deposit(uint256)';
/** The entrypoint's ERC-20 deposit, which pulls the amount with `transferFrom`. */
exports.ERC20_DEPOSIT_SIGNATURE = 'deposit(address,uint256,uint256)';
/** The entrypoint's two deposit functions. */
exports.ENTRYPOINT_DEPOSIT_INTERFACE = new ethers_1.Interface([
    'function deposit(uint256 _precommitment) payable returns (uint256)',
    'function deposit(address _asset, uint256 _value, uint256 _precommitment) returns (uint256)'
]);
/**
 * Decodes an entrypoint deposit call. The precommitment ties it to the receiving account. Null for
 * any other or undecodable call.
 */
const readPrivacyPoolsDeposit = ({ data, value }) => {
    let parsed;
    try {
        parsed = exports.ENTRYPOINT_DEPOSIT_INTERFACE.parseTransaction({ data, value });
    }
    catch {
        return null;
    }
    if (!parsed)
        return null;
    if (parsed.signature === exports.NATIVE_DEPOSIT_SIGNATURE)
        return {
            precommitment: BigInt(parsed.args[0]),
            assetAddress: (0, privacyPools_1.toPrivacyPoolsAssetAddress)(constants_1.ZERO_ADDRESS),
            amount: value
        };
    if (parsed.signature === exports.ERC20_DEPOSIT_SIGNATURE)
        return {
            precommitment: BigInt(parsed.args[2]),
            assetAddress: String(parsed.args[0]),
            amount: BigInt(parsed.args[1])
        };
    return null;
};
exports.readPrivacyPoolsDeposit = readPrivacyPoolsDeposit;
/** Encodes a deposit call - the inverse of `readPrivacyPoolsDeposit`. */
const encodePrivacyPoolsDeposit = ({ isNative, assetAddress, amount, precommitment }) => isNative
    ? {
        value: amount,
        data: exports.ENTRYPOINT_DEPOSIT_INTERFACE.encodeFunctionData(exports.NATIVE_DEPOSIT_SIGNATURE, [
            precommitment
        ])
    }
    : {
        value: 0n,
        data: exports.ENTRYPOINT_DEPOSIT_INTERFACE.encodeFunctionData(exports.ERC20_DEPOSIT_SIGNATURE, [
            assetAddress,
            amount,
            precommitment
        ])
    };
exports.encodePrivacyPoolsDeposit = encodePrivacyPoolsDeposit;
//# sourceMappingURL=deposit.js.map