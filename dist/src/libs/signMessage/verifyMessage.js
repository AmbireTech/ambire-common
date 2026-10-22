"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyMessage = verifyMessage;
const ethers_1 = require("ethers");
const signature_validator_1 = require("@ambire/signature-validator");
const eth_sig_util_1 = require("@metamask/eth-sig-util");
const errorDecoder_1 = require("../errorDecoder");
const helpers_1 = require("../errorDecoder/helpers");
const signMessage_1 = require("./signMessage");
/**
 * Verifies the signature of a message using the provided signer and signature
 * via a "magic" universal validator contract using the provided provider to
 * verify the signature on-chain. The contract deploys itself within the
 * `eth_call`, tries to verify the signature using ERC-6492, ERC-1271, and
 * `ecrecover`, and returns the value to the function.
 *
 * Note: you only need to pass one of: `message` or `typedData`
 */
async function verifyMessage({ provider, signer, signature, message, authorization, typedData }) {
    let finalDigest;
    if (message) {
        try {
            finalDigest = (0, ethers_1.hashMessage)(message);
            if (!finalDigest)
                throw Error('Hashing the message returned no (falsy) result.');
        }
        catch (e) {
            throw Error(`Preparing the just signed (standard) message for validation failed. Please try again or contact Ambire support if the issue persists. Error details: ${e?.message || 'missing'}`);
        }
    }
    else if (authorization) {
        finalDigest = authorization;
    }
    else {
        // According to the Props definition, either `message` or `typedData` must be provided.
        // However, TypeScript struggles with this `else` condition, incorrectly treating `typedData` as undefined.
        // To prevent TypeScript from complaining, we've added this runtime validation.
        if (!typedData) {
            throw new Error("Either 'message' or 'typedData' must be provided.");
        }
        try {
            // TODO: Hardcoded to V4, use the version from the typedData if we want to support other versions?
            finalDigest = (0, ethers_1.hexlify)(eth_sig_util_1.TypedDataUtils.eip712Hash(
            // @ts-ignore
            (0, signMessage_1.adaptTypedMessageForMetaMaskSigUtil)({ ...typedData }), eth_sig_util_1.SignTypedDataVersion.V4));
            if (!finalDigest)
                throw Error('Hashing the typedData returned no (falsy) result.');
        }
        catch (e) {
            throw Error(`Preparing the just signed (typed data) message for validation failed. Please try again or contact Ambire support if the issue persists. Error details: ${e?.message || 'missing'}`);
        }
    }
    // this 'magic' universal validator contract will deploy itself within the eth_call, try to verify the signature using
    // ERC-6492, ERC-1271 and ecrecover, and return the value to us
    const coder = new ethers_1.AbiCoder();
    let callResult;
    try {
        const deploylessRes = await (0, signature_validator_1.verifyMessage)({
            signer,
            finalDigest,
            signature,
            provider: provider
        });
        if (deploylessRes === true)
            callResult = '0x01';
        else if (deploylessRes === false)
            callResult = '0x00';
        else
            callResult = deploylessRes;
    }
    catch (e) {
        const decoded = (0, errorDecoder_1.decodeError)(e);
        const moreDetails = (0, helpers_1.getErrorCodeStringFromReason)(decoded.reason || e?.message || '');
        throw new Error(`Validating the just signed message failed. Please try again or contact Ambire support if the issue persists. Error details: UniversalValidator call failed (${decoded.type}).${moreDetails ? `${moreDetails}` : ''}`);
    }
    if (callResult === '0x01')
        return true;
    if (callResult === '0x00')
        return false;
    if (callResult.startsWith('0x08c379a0'))
        throw new Error(`Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support. Error details:: ${coder.decode(['string'], `0x${callResult.slice(10)}`)[0]}`);
    throw new Error(`Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support. Error details: unexpected result from the UniversalValidator: ${callResult}`);
}
//# sourceMappingURL=verifyMessage.js.map