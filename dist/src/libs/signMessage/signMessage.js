"use strict";
// @ts-nocheck
Object.defineProperty(exports, "__esModule", { value: true });
exports.getSafeMessageTypedData = exports.getEIP712Hash = exports.getSafeTypedDataForIsValidSignature = exports.getSafeV1TypedData = exports.getSafeTypedData = exports.wrapCounterfactualSign = exports.get7702UserOpTypedData = exports.getTypedData = exports.adaptTypedMessageForMetaMaskSigUtil = exports.doesEIP712MessageContainAddress = exports.wrapWallet = exports.wrapStandard = exports.wrapUnprotected = exports.isCallToSelfOrAmbireOp = exports.AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE = exports.EIP_1271_NOT_SUPPORTED_BY = void 0;
exports.getExecuteSignature = getExecuteSignature;
exports.getPlainTextSignature = getPlainTextSignature;
exports.getEIP712Signature = getEIP712Signature;
exports.getEntryPointAuthorization = getEntryPointAuthorization;
exports.adjustEntryPointAuthorization = adjustEntryPointAuthorization;
exports.getAuthorizationHash = getAuthorizationHash;
exports.get7702Sig = get7702Sig;
exports.getVerifyMessageSignature = getVerifyMessageSignature;
exports.getAppFormatted = getAppFormatted;
const ethers_1 = require("ethers");
const eth_sig_util_1 = require("@metamask/eth-sig-util");
const addresses_1 = require("../../consts/addresses");
const stripHexPrefix_1 = require("../../utils/stripHexPrefix");
const accountOp_1 = require("../accountOp/accountOp");
const richJson_1 = require("../richJson/richJson");
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
    'taskon.xyz',
    'hyperliquid.xyz',
    'bitrefill.com'
];
exports.AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE = 'Signing an AmbireOperation is not allowed';
/**
 * Check if the typedData's intention is to target the current account
 */
const isCallToSelfOrAmbireOp = (typedData, account) => {
    const isAmbireOp = typedData.primaryType === 'AmbireOperation' || 'AmbireOperation' in typedData.types;
    const isAmbire4337Op = typedData.primaryType === 'Ambire4337AccountOp' || 'Ambire4337AccountOp' in typedData.types;
    const isAmbireExecuteOp = typedData.primaryType === 'AmbireExecuteAccountOp' ||
        'AmbireExecuteAccountOp' in typedData.types;
    const verifyingContract = typedData.domain.verifyingContract;
    const isVerifyingContractSameAsAccount = verifyingContract && account && verifyingContract.toLowerCase() === account.addr.toLowerCase();
    return isAmbireOp || isAmbire4337Op || isAmbireExecuteOp || isVerifyingContractSameAsAccount;
};
exports.isCallToSelfOrAmbireOp = isCallToSelfOrAmbireOp;
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
const signWithHardwareWalletSigningRequest = (request, sign, withHardwareWalletSigningRequest) => (withHardwareWalletSigningRequest ? withHardwareWalletSigningRequest(request, sign) : sign());
const doesEIP712MessageContainAddress = (message, address) => (0, richJson_1.stringify)(message).toLowerCase().includes(address.toLowerCase());
exports.doesEIP712MessageContainAddress = doesEIP712MessageContainAddress;
const adaptTypedMessageForMetaMaskSigUtil = (typedMessage) => {
    return {
        ...typedMessage,
        types: {
            ...typedMessage.types,
            EIP712Domain: typedMessage.types.EIP712Domain ?? []
        },
        // There is a slight difference between EthersJS v6 and @metamask/eth-sig-util
        // in terms of the domain object props.
        domain: {
            ...typedMessage.domain,
            name: typedMessage.domain.name ?? undefined,
            version: typedMessage.domain.version ?? undefined,
            chainId: typedMessage.domain.chainId ? (0, ethers_1.toNumber)(typedMessage.domain.chainId) : undefined,
            verifyingContract: typedMessage.domain.verifyingContract ?? undefined,
            salt: typedMessage.domain.salt
                ? // TypeScript expects domain.salt as ArrayBuffer (MetaMask types)
                    // Runtime accepts any BytesLike (hex or Uint8Array)
                    // Cast to avoid TS error — works without conversion
                    typedMessage.domain.salt
                : undefined
        }
    };
};
exports.adaptTypedMessageForMetaMaskSigUtil = adaptTypedMessageForMetaMaskSigUtil;
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
        ],
        EIP712Domain: [
            { name: 'name', type: 'string' },
            { name: 'version', type: 'string' },
            { name: 'chainId', type: 'uint256' },
            { name: 'verifyingContract', type: 'address' },
            { name: 'salt', type: 'bytes32' }
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
// Either `message` or `typedData` must be provided - never both.
// Authorize the execute calls according to the version of the smart account
async function getExecuteSignature(network, accountOp, accountState, signer, provider) {
    const ctx = provider ? { chainId: network.chainId, provider } : undefined;
    // if we're authorizing calls for a v1 contract, we do a sign message
    // on the hash of the calls
    if (!accountState.isV2) {
        const message = (0, ethers_1.hexlify)((0, accountOp_1.accountOpSignableHash)(accountOp, network.chainId));
        return (0, exports.wrapStandard)(await signer.signMessage(message, ctx));
    }
    // txns for v2 contracts are always eip-712 so we put the hash of the calls
    // in eip-712 format
    const typedData = (0, exports.getTypedData)(network.chainId, accountState.accountAddr, (0, ethers_1.hexlify)((0, accountOp_1.accountOpSignableHash)(accountOp, network.chainId)));
    return (0, exports.wrapStandard)(await signer.signTypedData(typedData, ctx));
}
async function getPlainTextSignature(messageHex, network, account, accountState, signer, isOG = false, withHardwareWalletSigningRequest, provider) {
    const dedicatedToOneSA = signer.key.dedicatedToOneSA;
    const ctx = provider ? { chainId: network.chainId, provider } : undefined;
    if (!!account.safeCreation) {
        // Safe always signs a typed data, even if plain sig
        const typedData = (0, exports.getSafeMessageTypedData)(messageHex, network.chainId, account.addr);
        return {
            signature: (await signWithHardwareWalletSigningRequest({ type: 'eip-712', data: typedData }, () => signer.signTypedData(typedData, ctx), withHardwareWalletSigningRequest)),
            hash: (0, exports.getEIP712Hash)(typedData)
        };
    }
    if (!account.creation)
        return {
            signature: (await signWithHardwareWalletSigningRequest({ type: 'message', data: { message: messageHex } }, () => signer.signMessage(messageHex, ctx), withHardwareWalletSigningRequest))
        };
    if (!accountState.isV2) {
        const lowercaseHexAddrWithout0x = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(account.addr.toLowerCase().slice(2)));
        const checksummedHexAddrWithout0x = (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(account.addr.slice(2)));
        const asciiAddrLowerCase = account.addr.toLowerCase();
        const isAsciiAddressInMessage = messageHex.toLowerCase().includes(asciiAddrLowerCase);
        const isLowercaseHexAddressInMessage = messageHex.includes(lowercaseHexAddrWithout0x.slice(2));
        const isChecksummedHexAddressInMessage = messageHex.includes(checksummedHexAddrWithout0x.slice(2));
        if (
        // @NOTE: isOG is to allow tem members to sign anything with v1 accounts regardless of safety and security
        !isOG &&
            !isAsciiAddressInMessage &&
            !isLowercaseHexAddressInMessage &&
            !isChecksummedHexAddressInMessage) {
            throw new Error('Signing messages is disallowed for v1 accounts. Please contact support to proceed');
        }
        return {
            signature: (0, exports.wrapUnprotected)(await signWithHardwareWalletSigningRequest({ type: 'message', data: { message: messageHex } }, () => signer.signMessage(messageHex, ctx), withHardwareWalletSigningRequest))
        };
    }
    // if it's safe, we proceed
    if (dedicatedToOneSA) {
        return {
            signature: (0, exports.wrapUnprotected)(await signWithHardwareWalletSigningRequest({ type: 'message', data: { message: messageHex } }, () => signer.signMessage(messageHex, ctx), withHardwareWalletSigningRequest))
        };
    }
    // in case of only_standard priv key, we transform the data
    // for signing to EIP-712. This is because the key is not labeled safe
    // and it should inform the user that he's performing an Ambire Op.
    // This is important as this key could be a metamask one and someone
    // could be phishing him into approving an Ambire Op without him
    // knowing
    const typedData = (0, exports.getTypedData)(network.chainId, account.addr, (0, ethers_1.hashMessage)((0, ethers_1.getBytes)(messageHex)));
    return {
        signature: (0, exports.wrapStandard)(await signWithHardwareWalletSigningRequest({ type: 'eip-712', data: typedData }, () => signer.signTypedData(typedData, ctx), withHardwareWalletSigningRequest))
    };
}
async function getEIP712Signature(message, account, accountState, signer, network, isOG = false, withHardwareWalletSigningRequest, allowAmbireOperation = false, provider) {
    const ctx = provider ? { chainId: network.chainId, provider } : undefined;
    if (!message.types.EIP712Domain) {
        throw new Error('Ambire only supports signing EIP712 typed data messages. Please try again with a valid EIP712 message.');
    }
    if (!message.primaryType) {
        throw new Error('The primaryType is missing in the typed data message incoming. Please try again with a valid EIP712 message.');
    }
    if (!!account.safeCreation) {
        // Safe wraps the EIP-712 message in it's own EIP-712
        const typedData = (0, exports.getSafeMessageTypedData)(message, network.chainId, account.addr);
        return {
            signature: (await signWithHardwareWalletSigningRequest({ type: 'eip-712', data: typedData }, () => signer.signTypedData(typedData, ctx), withHardwareWalletSigningRequest)),
            hash: (0, exports.getEIP712Hash)(typedData)
        };
    }
    if (!account.creation)
        return {
            signature: (await signWithHardwareWalletSigningRequest({ type: 'eip-712', data: message }, () => signer.signTypedData(message, ctx), withHardwareWalletSigningRequest))
        };
    if ((0, exports.isCallToSelfOrAmbireOp)(message, account) && !allowAmbireOperation) {
        throw new Error(exports.AMBIRE_OPERATION_SIGNING_NOT_ALLOWED_MESSAGE);
    }
    if (!accountState.isV2) {
        if (
        // @NOTE: isOG is to allow tem members to sign anything with v1 accounts regardless of safety and security
        !isOG &&
            !(0, exports.doesEIP712MessageContainAddress)(message, account.addr) &&
            !(message.domain.name === 'Permit2' &&
                message.domain.verifyingContract &&
                (0, ethers_1.getAddress)(message.domain.verifyingContract) === addresses_1.PERMIT_2_ADDRESS &&
                message.message &&
                message.message.spender &&
                addresses_1.UNISWAP_UNIVERSAL_ROUTERS[Number(network.chainId)] &&
                addresses_1.UNISWAP_UNIVERSAL_ROUTERS[Number(network.chainId)] === (0, ethers_1.getAddress)(message.message.spender))) {
            throw new Error('Signing this eip-712 message is disallowed for v1 accounts as it does not contain the smart account address and therefore deemed unsafe');
        }
        return {
            signature: (0, exports.wrapUnprotected)(await signWithHardwareWalletSigningRequest({ type: 'eip-712', data: message }, () => signer.signTypedData(message, ctx), withHardwareWalletSigningRequest))
        };
    }
    // we do not allow signers who are not dedicated to one account to sign eip-712
    // messages in v2 as it could lead to reusing that key from
    const dedicatedToOneSA = signer.key.dedicatedToOneSA;
    if (!dedicatedToOneSA) {
        throw new Error(`Signer with address ${signer.key.addr} does not have privileges to execute this operation. Please choose a different signer and try again`);
    }
    return {
        signature: (0, exports.wrapUnprotected)(await signWithHardwareWalletSigningRequest({ type: 'eip-712', data: message }, () => signer.signTypedData(message, ctx), withHardwareWalletSigningRequest))
    };
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
        '0x05', // magic authorization string
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
const getSafeTypedData = (chainId, safeAddr, safeTx) => {
    const domain = {
        chainId: chainId.toString(),
        verifyingContract: safeAddr
    };
    const types = {
        EIP712Domain: [
            {
                name: 'chainId',
                type: 'uint256'
            },
            {
                name: 'verifyingContract',
                type: 'address'
            }
        ],
        SafeTx: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
            { name: 'operation', type: 'uint8' },
            { name: 'safeTxGas', type: 'uint256' },
            { name: 'baseGas', type: 'uint256' },
            { name: 'gasPrice', type: 'uint256' },
            { name: 'gasToken', type: 'address' },
            { name: 'refundReceiver', type: 'address' },
            { name: 'nonce', type: 'uint256' }
        ]
    };
    return {
        domain,
        types,
        message: safeTx,
        primaryType: 'SafeTx'
    };
};
exports.getSafeTypedData = getSafeTypedData;
const getSafeV1TypedData = (safeAddr, safeTx) => {
    const domain = {
        verifyingContract: safeAddr
    };
    const types = {
        EIP712Domain: [
            {
                name: 'verifyingContract',
                type: 'address'
            }
        ],
        SafeTx: [
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'data', type: 'bytes' },
            { name: 'operation', type: 'uint8' },
            { name: 'safeTxGas', type: 'uint256' },
            { name: 'baseGas', type: 'uint256' },
            { name: 'gasPrice', type: 'uint256' },
            { name: 'gasToken', type: 'address' },
            { name: 'refundReceiver', type: 'address' },
            { name: 'nonce', type: 'uint256' }
        ]
    };
    return {
        domain,
        types,
        message: safeTx,
        primaryType: 'SafeTx'
    };
};
exports.getSafeV1TypedData = getSafeV1TypedData;
const getSafeTypedDataForIsValidSignature = (chainId, safeAddr, hash) => {
    const domain = {
        chainId: chainId.toString(),
        verifyingContract: safeAddr
    };
    const types = {
        EIP712Domain: [
            {
                name: 'chainId',
                type: 'uint256'
            },
            {
                name: 'verifyingContract',
                type: 'address'
            }
        ],
        SafeMessage: [{ name: 'message', type: 'bytes' }]
    };
    return {
        domain,
        types,
        message: { message: hash },
        primaryType: 'SafeMessage'
    };
};
exports.getSafeTypedDataForIsValidSignature = getSafeTypedDataForIsValidSignature;
const getEIP712Hash = (typedData) => `0x${eth_sig_util_1.TypedDataUtils.eip712Hash((0, exports.adaptTypedMessageForMetaMaskSigUtil)({ ...typedData }), eth_sig_util_1.SignTypedDataVersion.V4).toString('hex')}`;
exports.getEIP712Hash = getEIP712Hash;
const getSafeMessageTypedData = (message, chainId, safeAddr) => (0, exports.getSafeTypedDataForIsValidSignature)(chainId, safeAddr, typeof message === 'string' ? (0, ethers_1.hashMessage)((0, ethers_1.getBytes)(message)) : (0, exports.getEIP712Hash)(message));
exports.getSafeMessageTypedData = getSafeMessageTypedData;
//# sourceMappingURL=signMessage.js.map