"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodeCalls = encodeCalls;
exports.getCalculatedSafeAddress = getCalculatedSafeAddress;
exports.decodeSetupData = decodeSetupData;
exports.getSafeTxn = getSafeTxn;
exports.getSafeBroadcastTxn = getSafeBroadcastTxn;
exports.sortByAddress = sortByAddress;
exports.getSafeTxnHash = getSafeTxnHash;
exports.propose = propose;
exports.confirm = confirm;
exports.addMessage = addMessage;
exports.getMessage = getMessage;
exports.addMessageSignature = addMessageSignature;
exports.getPendingTransactions = getPendingTransactions;
exports.getLatestMessages = getLatestMessages;
exports.getTransaction = getTransaction;
exports.fetchAllPending = fetchAllPending;
exports.toCallsUserRequest = toCallsUserRequest;
exports.toSigMessageUserRequests = toSigMessageUserRequests;
exports.getAlreadySignedOwners = getAlreadySignedOwners;
exports.getImportedSignersThatHaveNotSigned = getImportedSignersThatHaveNotSigned;
exports.getSigs = getSigs;
exports.sortSigs = sortSigs;
exports.getSameNonceRequests = getSameNonceRequests;
exports.fetchExecutedTransactions = fetchExecutedTransactions;
exports.getNonce = getNonce;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const eth_sig_util_1 = require("@metamask/eth-sig-util");
const api_kit_1 = tslib_1.__importDefault(require("@safe-global/api-kit"));
const Safe_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/Safe.json"));
const safe_1 = require("../../consts/safe");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const accountOp_1 = require("../accountOp/accountOp");
const signMessage_1 = require("../signMessage/signMessage");
const multiCallAbi = [
    { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
    {
        inputs: [{ internalType: 'bytes', name: 'transactions', type: 'bytes' }],
        name: 'multiSend',
        outputs: [],
        stateMutability: 'payable',
        type: 'function'
    }
];
const SAFE_CALL_OPERATION = 0;
const SAFE_DELEGATE_CALL_OPERATION = 1;
function encodeCalls(op) {
    const calls = (0, accountOp_1.getSignableCalls)(op);
    if (calls.length === 1) {
        const singleCall = calls[0];
        return {
            to: singleCall[0],
            value: BigInt(singleCall[1]),
            data: singleCall[2],
            operation: SAFE_CALL_OPERATION
        };
    }
    const multiSendData = new ethers_1.Interface(multiCallAbi).encodeFunctionData('multiSend', [
        (0, ethers_1.concat)(calls.map((call) => {
            return (0, ethers_1.solidityPacked)(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [SAFE_CALL_OPERATION, call[0], BigInt(call[1]), BigInt((0, ethers_1.getBytes)(call[2]).length), call[2]]);
        }))
    ]);
    return {
        to: safe_1.multiSendAddr,
        value: 0n,
        data: multiSendData,
        operation: SAFE_DELEGATE_CALL_OPERATION
    };
}
async function getCalculatedSafeAddress(creation, provider) {
    const salt = (0, ethers_1.keccak256)((0, ethers_1.concat)([(0, ethers_1.keccak256)(creation.setupData), (0, ethers_1.zeroPadValue)((0, ethers_1.toBeHex)(creation.saltNonce || 0), 32)]));
    const factoryAbi = ['function proxyCreationCode() view returns (bytes)'];
    const factory = new ethers_1.Contract(creation.factoryAddress, factoryAbi, provider);
    let proxyCreationCode;
    try {
        proxyCreationCode = await factory.proxyCreationCode();
    }
    catch (e) {
        console.error(`failed to call proxyCreationCode on Safe factory with addr: ${creation.factoryAddress}`);
        return null;
    }
    const abiCoder = new ethers_1.AbiCoder();
    const bytecode = (0, ethers_1.concat)([
        proxyCreationCode,
        abiCoder.encode(['address'], [creation.singleton])
    ]);
    return (0, ethers_1.getCreate2Address)(creation.factoryAddress, salt, (0, ethers_1.keccak256)(bytecode));
}
/**
 * The setup() method is the same for v1.3, 1.4.1, 1.5. We decode it
 * to fetch the initial owners of the Safe so that we could put them
 * in the account associatedKeys
 */
function decodeSetupData(setupData) {
    const setupMethodAbi = [
        'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)'
    ];
    const setupMethodInterface = new ethers_1.Interface(setupMethodAbi);
    let decoded = null;
    try {
        decoded = setupMethodInterface.decodeFunctionData('setup', setupData);
    }
    catch (e) {
        console.error('failed to decode the Safe setup data');
        return [];
    }
    return Object.keys(decoded[0]).map((key) => decoded[0][key]);
}
/**
 * Construct a Safe txn for signing
 */
function getSafeTxn(op, state) {
    // todo: we're blindly trusting the returned txn from Safe Global, is this OK?
    if (op.safeTx) {
        return {
            to: op.safeTx.to,
            value: (0, ethers_1.toBeHex)(op.safeTx.value),
            data: op.safeTx.data ? op.safeTx.data : '0x',
            operation: op.safeTx.operation,
            safeTxGas: (0, ethers_1.toBeHex)(op.safeTx.safeTxGas),
            baseGas: (0, ethers_1.toBeHex)(op.safeTx.baseGas),
            gasPrice: (0, ethers_1.toBeHex)(op.safeTx.gasPrice),
            gasToken: op.safeTx.gasToken,
            refundReceiver: op.safeTx.refundReceiver ? op.safeTx.refundReceiver : '0x',
            nonce: (0, ethers_1.toBeHex)(op.safeTx.nonce)
        };
    }
    const coder = new ethers_1.AbiCoder();
    const { to, value, data, operation } = encodeCalls(op);
    return {
        to: to,
        value: (0, ethers_1.toBeHex)(value),
        data: data,
        operation,
        safeTxGas: (0, ethers_1.toBeHex)(0),
        baseGas: (0, ethers_1.toBeHex)(0),
        gasPrice: (0, ethers_1.toBeHex)(0),
        gasToken: ethers_1.ZeroAddress,
        refundReceiver: ethers_1.ZeroAddress,
        nonce: (0, ethers_1.toBeHex)(op.nonce || state.nonce || 0n)
    };
}
function getSafeBroadcastTxn(op, state) {
    const exec = new ethers_1.Interface(safe_1.execTransactionAbi);
    const safeTxn = getSafeTxn(op, state);
    return {
        to: op.accountAddr,
        value: 0n,
        data: exec.encodeFunctionData('execTransaction', [
            safeTxn.to,
            safeTxn.value,
            safeTxn.data,
            safeTxn.operation,
            safeTxn.safeTxGas,
            safeTxn.baseGas,
            safeTxn.gasPrice,
            safeTxn.gasToken,
            safeTxn.refundReceiver,
            op.signature
        ])
    };
}
/**
 * In Safe, the signatures need to be in order, starting with
 * the smallest ecrecover(sig) owner, ascending. Here, we
 * sort the owners in that way
 */
function sortByAddress(sortableKeys) {
    return sortableKeys.sort((a, b) => {
        const aBig = BigInt(a.addr.toLowerCase());
        const bBig = BigInt(b.addr.toLowerCase());
        return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
    });
}
function getSafeTxnHash(typedData) {
    return `0x${eth_sig_util_1.TypedDataUtils.eip712Hash((0, signMessage_1.adaptTypedMessageForMetaMaskSigUtil)({ ...typedData }), eth_sig_util_1.SignTypedDataVersion.V4).toString('hex')}`;
}
async function propose(txn, chainId, safeAddress, owner, ownerSig, safeTxHash) {
    const apiKit = new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    const proposeTransactionProps = {
        safeAddress: (0, ethers_1.getAddress)(safeAddress),
        safeTxHash: safeTxHash,
        safeTransactionData: {
            ...txn,
            to: (0, ethers_1.getAddress)(txn.to),
            baseGas: BigInt(txn.baseGas).toString(),
            gasPrice: BigInt(txn.gasPrice).toString(),
            safeTxGas: BigInt(txn.safeTxGas).toString(),
            value: BigInt(txn.value).toString(),
            nonce: parseInt(txn.nonce)
        },
        senderAddress: owner,
        senderSignature: ownerSig
    };
    return apiKit.proposeTransaction(proposeTransactionProps);
}
async function confirm(chainId, ownerSig, safeTxHash) {
    const apiKit = new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.confirmTransaction(safeTxHash, ownerSig);
}
async function addMessage(chainId, safeAddress, message, signature) {
    const apiKit = new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.addMessage(safeAddress, {
        message,
        signature
    });
}
async function getMessage({ chainId, threshold, messageHash }) {
    const apiKit = new api_kit_1.default({
        chainId: chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    const msg = await apiKit.getMessage(messageHash).catch((e) => null);
    if (!msg)
        return null;
    return {
        ...msg,
        isConfirmed: msg.confirmations.length >= threshold
    };
}
async function addMessageSignature(chainId, hash, signature) {
    const apiKit = new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.addMessageSignature(hash, signature);
}
async function getPendingTransactions(chainId, safeAddress) {
    const apiKit = new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    const response = await apiKit.getPendingTransactions(safeAddress, {
        ordering: 'nonce'
    });
    return { ...response, chainId, type: 'txn' };
}
/**
 * Due to the nature of signatures, we cannot ask for confirmed
 * signatures as the moment the threshold for the account changes,
 * the validity of the signatures change as well.
 * Removing an owner would do the same.
 * So we fetch the newest 15 and filter them on a higher level
 */
async function getLatestMessages(chainId, safeAddress) {
    const apiKit = new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    const response = await apiKit.getMessages(safeAddress, {
        ordering: '-created',
        limit: 15
    });
    const currentTime = new Date().getTime();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    // filter messages older than one week
    const finalRes = response.results.filter((m) => new Date(m.created).getTime() + oneWeek > currentTime);
    return { ...response, results: finalRes, chainId, type: 'message' };
}
async function getTransaction(chainId, safeTxnHash) {
    const apiKit = new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.getTransaction(safeTxnHash);
}
async function fetchAllPending(networks, safeAddr) {
    const results = {};
    for (let i = 0; i < networks.length; i++) {
        const network = networks[i];
        const responses = await Promise.all([
            getPendingTransactions(network.chainId, safeAddr),
            getLatestMessages(network.chainId, safeAddr)
        ]);
        responses.forEach((r) => {
            if (!results[r.chainId.toString()])
                results[r.chainId.toString()] = { txns: [], messages: [] };
            if (r.type === 'txn')
                results[r.chainId.toString()].txns = r.results;
            else
                results[r.chainId.toString()].messages = r.results.map((r) => {
                    return { ...r, isConfirmed: (r.confirmations?.length || 0) >= network.threshold };
                });
        });
    }
    return results;
}
function decodeMultiSend(transactionsHex) {
    const bytes = (0, ethers_1.getBytes)(transactionsHex);
    let i = 0;
    const results = [];
    while (i < bytes.length) {
        const operation = bytes[i];
        i += 1;
        const to = (0, ethers_1.hexlify)(bytes.slice(i, i + 20));
        i += 20;
        const value = BigInt((0, ethers_1.hexlify)(bytes.slice(i, i + 32)));
        i += 32;
        const dataLength = Number(BigInt((0, ethers_1.hexlify)(bytes.slice(i, i + 32))));
        i += 32;
        const data = (0, ethers_1.hexlify)(bytes.slice(i, i + dataLength));
        i += dataLength;
        results.push({
            operation,
            to,
            value,
            data
        });
    }
    return results;
}
function toCallsUserRequest(safeAddr, response) {
    const userRequests = [];
    Object.keys(response).forEach((chainId) => {
        const txns = response[chainId].txns;
        txns.forEach((txn) => {
            let calls = [];
            try {
                // try to decode the data to check if it's a batch
                // if it is, use it; otherwise, construct a single call reqx
                const multisendInterface = new ethers_1.Interface(multiCallAbi);
                const multiSendCall = multisendInterface.decodeFunctionData('multiSend', txn.data);
                calls = decodeMultiSend(multiSendCall[0]).map((call) => ({
                    to: call.to,
                    value: call.value,
                    data: call.data
                }));
            }
            catch (e) {
                // this just means it's not a batch
                calls = [{ to: txn.to, value: BigInt(txn.value), data: txn.data || '0x' }];
            }
            const signature = txn.confirmations
                ? (0, ethers_1.concat)(txn.confirmations?.map((c) => c.signature))
                : null;
            if (!signature)
                return;
            userRequests.push({
                type: 'calls',
                params: {
                    userRequestParams: {
                        calls,
                        meta: {
                            accountAddr: safeAddr,
                            chainId: BigInt(chainId),
                            safeTxnProps: {
                                txnId: txn.safeTxHash,
                                signature,
                                nonce: BigInt(txn.nonce)
                            },
                            safeTx: txn
                        }
                    },
                    executionType: 'queue'
                }
            });
        });
    });
    return userRequests;
}
function toSigMessageUserRequests(response) {
    const userRequests = [];
    Object.keys(response).forEach((chainId) => {
        const messages = response[chainId].messages;
        messages.forEach((message) => {
            const signature = message.confirmations
                ? (0, ethers_1.concat)(message.confirmations.map((c) => c.signature))
                : null;
            if (!signature)
                return;
            userRequests.push({
                type: 'safeSignMessageRequest',
                params: {
                    chainId: BigInt(chainId),
                    signed: message.confirmations.map((confirm) => confirm.owner),
                    message: typeof message.message === 'string'
                        ? (0, ethers_1.hexlify)((0, ethers_1.toUtf8Bytes)(message.message))
                        : message.message,
                    messageHash: message.messageHash,
                    signature: sortSigs(message.confirmations.map((c) => c.signature), message.messageHash, message.confirmations),
                    created: new Date(message.created).getTime(),
                    signatures: message.confirmations.map((c) => c.signature)
                },
                isConfirmed: !!message.isConfirmed
            });
        });
    });
    return userRequests;
}
function getOwnerFromSafeTx(sig, confirmations) {
    return confirmations?.find((c) => c.signature === sig)?.owner;
}
function recoverOwner(sig, hash, confirmations) {
    // a transaction from Safe Global may have signatures that are not
    // ecdsa; therefore, we cannot extract the owner from them by using
    // a plain recoverAddress. We rely on the Safe Global information
    const safeOwner = getOwnerFromSafeTx(sig, confirmations);
    if (safeOwner)
        return safeOwner;
    // an ambire sig is always ecdsa
    return (0, ethers_1.recoverAddress)(hash, sig);
}
// the signature is 130 x number_of_sigs + 2 (0x) symbols long
// so we cut the hex (0x) from the beginning
// then take each sig (substring(0, 130)) and recover the address
// finally, we update everything
function getAlreadySignedOwners(signature, hash, safeTx) {
    const signatures = signature.substring(2);
    const signed = [];
    for (let i = 0; i < signatures.length; i += 130) {
        const sig = `0x${signatures.substring(i, i + 130)}`;
        signed.push(recoverOwner(sig, hash, safeTx?.confirmations));
    }
    return signed;
}
function getImportedSignersThatHaveNotSigned(signed, importedOwners) {
    return importedOwners.filter((o) => !signed.includes(o));
}
function getSigs(signature) {
    if (!signature)
        return [];
    const signed = [];
    const signatures = signature.substring(2);
    for (let i = 0; i < signatures.length; i += 130) {
        signed.push(`0x${signatures.substring(i, i + 130)}`);
    }
    return signed;
}
function sortSigs(signatures, hash, confirmations) {
    const signed = [];
    for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        signed.push({ sig, addr: recoverOwner(sig, hash, confirmations) });
    }
    const sorted = sortByAddress(signed);
    return (0, ethers_1.concat)(sorted.map((s) => s.sig));
}
/**
 * Safe requests may have multiple "call" ones with the same nonce
 */
function getSameNonceRequests(requests) {
    return requests.reduce((acc, r) => {
        const key = r.signAccountOp.accountOp.nonce?.toString() || '0';
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(r);
        return acc;
    }, {});
}
async function fetchExecutedTransactions(txns) {
    let promises = [];
    const results = [];
    for (let i = 0; i < txns.length; i++) {
        const txn = txns[i];
        promises.push(getTransaction(txn.chainId, txn.safeTxnHash));
        // we're allowed a max of 5 req to the API per second so we
        // have to be careful - making 3 at a time from here
        if ((i + 1) % 3 === 0 || i + 1 === txns.length) {
            const responses = await Promise.all(promises);
            responses.forEach((r) => {
                if (r.transactionHash) {
                    results.push({
                        safeTxnHash: r.safeTxHash,
                        transactionHash: r.transactionHash,
                        nonce: r.nonce
                    });
                }
                else {
                    results.push({
                        safeTxnHash: r.safeTxHash,
                        nonce: r.nonce,
                        confirmations: r.confirmations
                    });
                }
            });
            await (0, wait_1.default)(1100);
            promises = [];
        }
    }
    return results;
}
async function getNonce(safeAddr, provider) {
    const safeInterface = new ethers_1.Contract(safeAddr, Safe_json_1.default, provider);
    return safeInterface.nonce();
}
//# sourceMappingURL=safe.js.map