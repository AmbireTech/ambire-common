"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wrapCounterfactualSign = exports.get7702UserOpTypedData = exports.getTypedData = exports.getAmbireReadableTypedData = exports.wrapWallet = exports.wrapStandard = exports.wrapUnprotected = exports.EIP_1271_NOT_SUPPORTED_BY = void 0;
exports.mapSignatureV = mapSignatureV;
exports.verifyMessage = verifyMessage;
exports.getExecuteSignature = getExecuteSignature;
exports.getPlainTextSignature = getPlainTextSignature;
exports.getEIP712Signature = getEIP712Signature;
exports.getEntryPointAuthorization = getEntryPointAuthorization;
exports.adjustEntryPointAuthorization = adjustEntryPointAuthorization;
exports.getAuthorizationHash = getAuthorizationHash;
exports.get7702Sig = get7702Sig;
exports.getVerifyMessageSignature = getVerifyMessageSignature;
exports.getAppFormatted = getAppFormatted;
const tslib_1 = require("tslib");
/* eslint-disable no-param-reassign */
const ethers_1 = require("ethers");
const UniversalSigValidator_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/UniversalSigValidator.json"));
const addresses_1 = require("../../consts/addresses");
const hexStringToUint8Array_1 = tslib_1.__importDefault(require("../../utils/hexStringToUint8Array"));
const isSameAddr_1 = tslib_1.__importDefault(require("../../utils/isSameAddr"));
const stripHexPrefix_1 = require("../../utils/stripHexPrefix");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_1 = require("../deployless/deployless");
const userOperation_1 = require("../userOperation/userOperation");
const utils_1 = require("./utils");
// EIP6492 signature ends in magicBytes, which ends with a 0x92,
// which makes it is impossible for it to collide with a valid ecrecover signature if packed in the r,s,v format,
// as 0x92 is not a valid value for v.
const magicBytes = '6492649264926492649264926492649264926492649264926492649264926492';
exports.EIP_1271_NOT_SUPPORTED_BY = [
    'opensea.io',
    'paraswap.xyz',
    'blur.io',
    'aevo.xyz',
    'socialscan.io',
    'tally.xyz',
    'questn.com',
    'taskon.xyz'
];
/**
 * For Unprotected signatures, we need to append 00 at the end
 * for ambire to recognize it
 */
const wrapUnprotected = (signature) => {
    return `${signature}00`;
};
exports.wrapUnprotected = wrapUnprotected;
/**
 * For EIP-712 signatures, we need to append 01 at the end
 * for ambire to recognize it.
 * For v1 contracts, we do ETH sign at the 01 slot, which we'll
 * call standard from now on
 */
const wrapStandard = (signature) => {
    return `${signature}01`;
};
exports.wrapStandard = wrapStandard;
/**
 * For v2 accounts acting as signers, we need to append the v2 wallet
 * addr that's the signer and a 02 mode at the end to indicate it's a wallet:
 * {sig+mode}{wallet_32bytes}{mode}
 */
const wrapWallet = (signature, walletAddr) => {
    const wallet32bytes = `${(0, stripHexPrefix_1.stripHexPrefix)((0, ethers_1.toBeHex)(0, 12))}${(0, stripHexPrefix_1.stripHexPrefix)(walletAddr)}`;
    return `${signature}${wallet32bytes}02`;
};
exports.wrapWallet = wrapWallet;
const getAmbireReadableTypedData = (chainId, verifyingAddr, v1Execute) => {
    const domain = {
        name: 'Ambire',
        version: '1',
        chainId: chainId.toString(),
        verifyingContract: verifyingAddr,
        salt: (0, ethers_1.toBeHex)(0, 32)
    };
    const types = {
        EIP712Domain: [
            {
                name: 'name',
                type: 'string'
            },
            {
                name: 'version',
                type: 'string'
            },
            {
                name: 'chainId',
                type: 'uint256'
            },
            {
                name: 'verifyingContract',
                type: 'address'
            },
            {
                name: 'salt',
                type: 'bytes32'
            }
        ],
        Calls: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' }
        ],
        AmbireReadableOperation: [
            { name: 'account', type: 'address' },
            { name: 'chainId', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'calls', type: 'Calls[]' }
        ]
    };
    return {
        kind: 'typedMessage',
        domain,
        types,
        message: v1Execute,
        primaryType: 'AmbireOperation'
    };
};
exports.getAmbireReadableTypedData = getAmbireReadableTypedData;
/**
 * Return the typed data for EIP-712 sign
 */
const getTypedData = (chainId, verifyingAddr, msgHash) => {
    const domain = {
        name: 'Ambire',
        version: '1',
        chainId: chainId.toString(),
        verifyingContract: verifyingAddr,
        salt: (0, ethers_1.toBeHex)(0, 32)
    };
    const types = {
        EIP712Domain: [
            {
                name: 'name',
                type: 'string'
            },
            {
                name: 'version',
                type: 'string'
            },
            {
                name: 'chainId',
                type: 'uint256'
            },
            {
                name: 'verifyingContract',
                type: 'address'
            },
            {
                name: 'salt',
                type: 'bytes32'
            }
        ],
        AmbireOperation: [
            { name: 'account', type: 'address' },
            { name: 'hash', type: 'bytes32' }
        ]
    };
    const message = {
        account: verifyingAddr,
        hash: msgHash
    };
    return {
        kind: 'typedMessage',
        domain,
        types,
        message,
        primaryType: 'AmbireOperation'
    };
};
exports.getTypedData = getTypedData;
/**
 * Return the typed data for EIP-712 sign
 */
const get7702UserOpTypedData = (chainId, txns, packedUserOp, userOpHash) => {
    const calls = txns.map((txn) => ({
        to: txn[0],
        value: txn[1],
        data: txn[2]
    }));
    const domain = {
        name: 'Ambire',
        version: '1',
        chainId,
        verifyingContract: packedUserOp.sender,
        salt: (0, ethers_1.toBeHex)(0, 32)
    };
    const types = {
        Transaction: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' }
        ],
        Ambire4337AccountOp: [
            { name: 'account', type: 'address' },
            { name: 'chainId', type: 'uint256' },
            { name: 'nonce', type: 'uint256' },
            { name: 'initCode', type: 'bytes' },
            { name: 'accountGasLimits', type: 'bytes32' },
            { name: 'preVerificationGas', type: 'uint256' },
            { name: 'gasFees', type: 'bytes32' },
            { name: 'paymasterAndData', type: 'bytes' },
            { name: 'callData', type: 'bytes' },
            { name: 'calls', type: 'Transaction[]' },
            { name: 'hash', type: 'bytes32' }
        ]
    };
    const message = {
        account: packedUserOp.sender,
        chainId,
        nonce: packedUserOp.nonce,
        initCode: packedUserOp.initCode,
        accountGasLimits: packedUserOp.accountGasLimits,
        preVerificationGas: packedUserOp.preVerificationGas,
        gasFees: packedUserOp.gasFees,
        paymasterAndData: packedUserOp.paymasterAndData,
        callData: packedUserOp.callData,
        calls,
        hash: userOpHash
    };
    return {
        kind: 'typedMessage',
        domain,
        types,
        message,
        primaryType: 'Ambire4337AccountOp'
    };
};
exports.get7702UserOpTypedData = get7702UserOpTypedData;
/**
 * Produce EIP6492 signature for Predeploy Contracts
 *
 * More info: https://eips.ethereum.org/EIPS/eip-6492
 *
 * @param {string} signature - origin ERC-1271 signature
 * @param {object} account
 * @returns {string} - EIP6492 signature
 */
const wrapCounterfactualSign = (signature, creation) => {
    const ABI = ['function deploy(bytes code, uint256 salt)'];
    const iface = new ethers_1.Interface(ABI);
    const factoryCallData = iface.encodeFunctionData('deploy', [creation.bytecode, creation.salt]);
    const coder = new ethers_1.AbiCoder();
    // EIP6492 signature
    return (coder.encode(['address', 'bytes', 'bytes'], [creation.factoryAddr, factoryCallData, signature]) + magicBytes);
};
exports.wrapCounterfactualSign = wrapCounterfactualSign;
function mapSignatureV(sigRaw) {
    const sig = (0, hexStringToUint8Array_1.default)(sigRaw);
    if (sig[64] < 27)
        sig[64] += 27;
    return (0, ethers_1.hexlify)(sig);
}
/**
 * Verifies the signature of a message using the provided signer and signature
 * via a "magic" universal validator contract using the provided provider to
 * verify the signature on-chain. The contract deploys itself within the
 * `eth_call`, tries to verify the signature using ERC-6492, ERC-1271, and
 * `ecrecover`, and returns the value to the function.
 *
 * Note: you only need to pass one of: `message` or `typedData`
 */
async function verifyMessage({ network, provider, signer, signature, message, authorization, typedData }) {
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
        // To resolve the "ambiguous primary types or unused types" error, remove
        // the `EIP712Domain` from `types` object. The domain type is inbuilt in
        // the EIP712 standard and hence TypedDataEncoder so you do not need to
        // specify it in the types, see:
        // {@link https://ethereum.stackexchange.com/a/151930}
        const typesWithoutEIP712Domain = { ...typedData.types };
        if (typesWithoutEIP712Domain.EIP712Domain) {
            // eslint-disable-next-line no-param-reassign
            delete typesWithoutEIP712Domain.EIP712Domain;
        }
        try {
            // the final digest for AmbireReadableOperation is the execute hash
            // as it's wrapped in mode.standard and onchain gets transformed to
            // an AmbireOperation
            if ('AmbireReadableOperation' in typedData.types) {
                const ambireReadableOperation = typedData.message;
                finalDigest = (0, ethers_1.hexlify)((0, accountOp_1.getSignableHash)(ambireReadableOperation.addr, ambireReadableOperation.chainId, ambireReadableOperation.nonce, ambireReadableOperation.calls.map(accountOp_1.callToTuple)));
            }
            else {
                finalDigest = ethers_1.TypedDataEncoder.hash(typedData.domain, typesWithoutEIP712Domain, typedData.message);
            }
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
        const deploylessVerify = (0, deployless_1.fromDescriptor)(provider, UniversalSigValidator_json_1.default, !network.rpcNoStateOverride);
        const deploylessRes = await deploylessVerify.call('isValidSigWithSideEffects', [
            signer,
            finalDigest,
            signature
        ]);
        if (deploylessRes[0] === true)
            callResult = '0x01';
        else if (deploylessRes[0] === false)
            callResult = '0x00';
        else
            callResult = deploylessRes[0];
    }
    catch (e) {
        throw new Error(`Validating the just signed message failed. Please try again or contact Ambire support if the issue persists. Error details: UniversalValidator call failed, more details: ${
        // TODO: Use the `reason` from the decodeError(e) instead, when this case is better handled in there
        e?.message || 'missing'}`);
    }
    if (callResult === '0x01')
        return true;
    if (callResult === '0x00')
        return false;
    if (callResult.startsWith('0x08c379a0'))
        throw new Error(`Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support. Error details:: ${coder.decode(['string'], `0x${callResult.slice(10)}`)[0]}`);
    throw new Error(`Ambire failed to validate the signature. Please make sure you are signing with the correct key or device. If the problem persists, please contact Ambire support. Error details: unexpected result from the UniversalValidator: ${callResult}`);
}
// Authorize the execute calls according to the version of the smart account
async function getExecuteSignature(network, accountOp, accountState, signer) {
    // if we're authorizing calls for a v1 contract, we do a sign message
    // on the hash of the calls
    if (!accountState.isV2) {
        const message = (0, ethers_1.hexlify)((0, accountOp_1.accountOpSignableHash)(accountOp, network.chainId));
        return (0, exports.wrapStandard)(await signer.signMessage(message));
    }
    // txns for v2 contracts are always eip-712 so we put the hash of the calls
    // in eip-712 format
    const typedData = (0, exports.getTypedData)(network.chainId, accountState.accountAddr, (0, ethers_1.hexlify)((0, accountOp_1.accountOpSignableHash)(accountOp, network.chainId)));
    return (0, exports.wrapStandard)(await signer.signTypedData(typedData));
}
async function getPlainTextSignature(message, network, account, accountState, signer, isOG = false) {
    const dedicatedToOneSA = signer.key.dedicatedToOneSA;
    let messageHex;
    if (message instanceof Uint8Array) {
        messageHex = (0, ethers_1.hexlify)(message);
    }
    else if (!(0, ethers_1.isHexString)(message)) {
        messageHex = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(message));
    }
    else {
        messageHex = message;
    }
    if (!account.creation) {
        const signature = await signer.signMessage(messageHex);
        return signature;
    }
    if (!accountState.isV2) {
        const lowercaseHexAddrWithout0x = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(account.addr.toLowerCase().slice(2)));
        const checksummedHexAddrWithout0x = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(account.addr.slice(2)));
        const asciiAddrLowerCase = account.addr.toLowerCase();
        const humanReadableMsg = message instanceof Uint8Array ? (0, ethers_1.hexlify)(message) : message;
        const isAsciiAddressInMessage = humanReadableMsg.toLowerCase().includes(asciiAddrLowerCase);
        const isLowercaseHexAddressInMessage = humanReadableMsg.includes(lowercaseHexAddrWithout0x.slice(2));
        const isChecksummedHexAddressInMessage = humanReadableMsg.includes(checksummedHexAddrWithout0x.slice(2));
        if (
        // @NOTE: isOG is to allow tem members to sign anything with v1 accounts regardless of safety and security
        !isOG &&
            !isAsciiAddressInMessage &&
            !isLowercaseHexAddressInMessage &&
            !isChecksummedHexAddressInMessage) {
            throw new Error('Signing messages is disallowed for v1 accounts. Please contact support to proceed');
        }
        return (0, exports.wrapUnprotected)(await signer.signMessage(messageHex));
    }
    // if it's safe, we proceed
    if (dedicatedToOneSA) {
        return (0, exports.wrapUnprotected)(await signer.signMessage(messageHex));
    }
    // in case of only_standard priv key, we transform the data
    // for signing to EIP-712. This is because the key is not labeled safe
    // and it should inform the user that he's performing an Ambire Op.
    // This is important as this key could be a metamask one and someone
    // could be phishing him into approving an Ambire Op without him
    // knowing
    const typedData = (0, exports.getTypedData)(network.chainId, account.addr, (0, ethers_1.hashMessage)((0, ethers_1.getBytes)(messageHex)));
    return (0, exports.wrapStandard)(await signer.signTypedData(typedData));
}
async function getEIP712Signature(message, account, accountState, signer, network, isOG = false) {
    if (!message.types.EIP712Domain) {
        throw new Error('Ambire only supports signing EIP712 typed data messages. Please try again with a valid EIP712 message.');
    }
    if (!message.primaryType) {
        throw new Error('The primaryType is missing in the typed data message incoming. Please try again with a valid EIP712 message.');
    }
    if (!account.creation) {
        const signature = await signer.signTypedData(message);
        return signature;
    }
    if (!accountState.isV2) {
        const asString = JSON.stringify(message).toLowerCase();
        if (
        // @NOTE: isOG is to allow tem members to sign anything with v1 accounts regardless of safety and security
        !isOG &&
            !asString.includes(account.addr.toLowerCase()) &&
            !(message.domain.name === 'Permit2' &&
                message.domain.verifyingContract &&
                (0, ethers_1.getAddress)(message.domain.verifyingContract) === addresses_1.PERMIT_2_ADDRESS &&
                message.message &&
                message.message.spender &&
                addresses_1.UNISWAP_UNIVERSAL_ROUTERS[Number(network.chainId)] &&
                addresses_1.UNISWAP_UNIVERSAL_ROUTERS[Number(network.chainId)] === (0, ethers_1.getAddress)(message.message.spender))) {
            throw new Error('Signing this eip-712 message is disallowed for v1 accounts as it does not contain the smart account address and therefore deemed unsafe');
        }
        return (0, exports.wrapUnprotected)(await signer.signTypedData(message));
    }
    // we do not allow signers who are not dedicated to one account to sign eip-712
    // messsages in v2 as it could lead to reusing that key from
    const dedicatedToOneSA = signer.key.dedicatedToOneSA;
    if (!dedicatedToOneSA) {
        throw new Error(`Signer with address ${signer.key.addr} does not have privileges to execute this operation. Please choose a different signer and try again`);
    }
    if ('AmbireReadableOperation' in message.types) {
        const ambireReadableOperation = message.message;
        if ((0, isSameAddr_1.default)(ambireReadableOperation.addr, account.addr)) {
            throw new Error('signature error: trying to sign an AmbireReadableOperation for the same address. Please contact support');
        }
        const hash = (0, ethers_1.hexlify)((0, accountOp_1.getSignableHash)(ambireReadableOperation.addr, ambireReadableOperation.chainId, ambireReadableOperation.nonce, ambireReadableOperation.calls.map(accountOp_1.callToTuple)));
        const ambireOperation = (0, exports.getTypedData)(ambireReadableOperation.chainId, account.addr, hash);
        const signature = (0, exports.wrapStandard)(await signer.signTypedData(ambireOperation));
        return (0, exports.wrapWallet)(signature, account.addr);
    }
    return (0, exports.wrapUnprotected)(await signer.signTypedData(message));
}
// get the typedData for the first ERC-4337 deploy txn
async function getEntryPointAuthorization(addr, chainId, nonce) {
    const hash = (0, accountOp_1.getSignableHash)(addr, chainId, nonce, [(0, accountOp_1.callToTuple)((0, userOperation_1.getActivatorCall)(addr))]);
    return (0, exports.getTypedData)(chainId, addr, (0, ethers_1.hexlify)(hash));
}
function adjustEntryPointAuthorization(entryPointSig) {
    // since normally when we sign an EIP-712 request, we wrap it in Unprotected,
    // we adjust the entry point authorization signature so we could execute a txn
    return (0, exports.wrapStandard)(entryPointSig.substring(0, entryPointSig.length - 2));
}
// the hash the user needs to eth_sign in order for his EOA to turn smarter
function getAuthorizationHash(chainId, contractAddr, nonce) {
    return (0, ethers_1.keccak256)((0, ethers_1.concat)([
        '0x05', // magic authrorization string
        (0, ethers_1.encodeRlp)([
            // zeros are empty bytes in rlp encoding
            chainId !== 0n ? (0, ethers_1.toBeHex)(chainId) : '0x',
            contractAddr,
            // zeros are empty bytes in rlp encoding
            nonce !== 0n ? (0, ethers_1.toBeHex)(nonce) : '0x'
        ])
    ]));
}
function getHexStringSignature(signature, account, accountState) {
    return account.creation && !accountState.isDeployed
        ? // https://eips.ethereum.org/EIPS/eip-6492
            (0, exports.wrapCounterfactualSign)(signature, account.creation)
        : signature;
}
function get7702Sig(chainId, nonce, implementation, signature) {
    return {
        address: implementation,
        chainId: (0, ethers_1.toBeHex)(chainId),
        nonce: (0, ethers_1.toBeHex)(nonce),
        r: signature.r,
        s: signature.s,
        v: (0, utils_1.get7702SigV)(signature),
        yParity: signature.yParity
    };
}
function getVerifyMessageSignature(signature, account, accountState) {
    if ((0, ethers_1.isHexString)(signature))
        return getHexStringSignature(signature, account, accountState);
    const sig = signature;
    // ethereum v is 27 or 28
    const v = (0, utils_1.get7702SigV)(sig);
    return (0, ethers_1.concat)([sig.r, sig.s, v]);
}
// get the signature in the format you want returned to the dapp/implementation
// for example, we return the counterfactual signature
// to the dapp if the account is not deployed
// and we return directly an EIP7702Signature if it's that type
function getAppFormatted(signature, account, accountState) {
    if ((0, ethers_1.isHexString)(signature))
        return getHexStringSignature(signature, account, accountState);
    return signature;
}
//# sourceMappingURL=signMessage.js.map