import { AbiCoder, concat, Contract, getAddress, getBytes, getCreate2Address, hexlify, Interface, keccak256, recoverAddress, solidityPacked, toBeHex, toUtf8Bytes, ZeroAddress, zeroPadValue } from 'ethers';
import { SignTypedDataVersion, TypedDataUtils } from '@metamask/eth-sig-util';
import SafeApiKit from '@safe-global/api-kit';
import SafeAbi from '../../../contracts/compiled/Safe.json';
import { execTransactionAbi, multiSendAddr } from '../../consts/safe';
import wait from '../../utils/wait';
import { getSignableCalls } from '../accountOp/accountOp';
import { adaptTypedMessageForMetaMaskSigUtil } from '../signMessage/signMessage';
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
export function encodeCalls(op) {
    const calls = getSignableCalls(op);
    if (calls.length === 1) {
        const singleCall = calls[0];
        return {
            to: singleCall[0],
            value: BigInt(singleCall[1]),
            data: singleCall[2],
            operation: SAFE_CALL_OPERATION
        };
    }
    const multiSendData = new Interface(multiCallAbi).encodeFunctionData('multiSend', [
        concat(calls.map((call) => {
            return solidityPacked(['uint8', 'address', 'uint256', 'uint256', 'bytes'], [SAFE_CALL_OPERATION, call[0], BigInt(call[1]), BigInt(getBytes(call[2]).length), call[2]]);
        }))
    ]);
    return {
        to: multiSendAddr,
        value: 0n,
        data: multiSendData,
        operation: SAFE_DELEGATE_CALL_OPERATION
    };
}
export async function getCalculatedSafeAddress(creation, provider) {
    const salt = keccak256(concat([keccak256(creation.setupData), zeroPadValue(toBeHex(creation.saltNonce || 0), 32)]));
    const factoryAbi = ['function proxyCreationCode() view returns (bytes)'];
    const factory = new Contract(creation.factoryAddress, factoryAbi, provider);
    let proxyCreationCode;
    try {
        proxyCreationCode = await factory.proxyCreationCode();
    }
    catch (e) {
        console.error(`failed to call proxyCreationCode on Safe factory with addr: ${creation.factoryAddress}`);
        return null;
    }
    const abiCoder = new AbiCoder();
    const bytecode = concat([
        proxyCreationCode,
        abiCoder.encode(['address'], [creation.singleton])
    ]);
    return getCreate2Address(creation.factoryAddress, salt, keccak256(bytecode));
}
/**
 * The setup() method is the same for v1.3, 1.4.1, 1.5. We decode it
 * to fetch the initial owners of the Safe so that we could put them
 * in the account associatedKeys
 */
export function decodeSetupData(setupData) {
    const setupMethodAbi = [
        'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment,address payable paymentReceiver)'
    ];
    const setupMethodInterface = new Interface(setupMethodAbi);
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
export function getSafeTxn(op, state) {
    // todo: we're blindly trusting the returned txn from Safe Global, is this OK?
    if (op.safeTx) {
        return {
            to: op.safeTx.to,
            value: toBeHex(op.safeTx.value),
            data: op.safeTx.data ? op.safeTx.data : '0x',
            operation: op.safeTx.operation,
            safeTxGas: toBeHex(op.safeTx.safeTxGas),
            baseGas: toBeHex(op.safeTx.baseGas),
            gasPrice: toBeHex(op.safeTx.gasPrice),
            gasToken: op.safeTx.gasToken,
            refundReceiver: op.safeTx.refundReceiver ? op.safeTx.refundReceiver : '0x',
            nonce: toBeHex(op.safeTx.nonce)
        };
    }
    const coder = new AbiCoder();
    const { to, value, data, operation } = encodeCalls(op);
    return {
        to: to,
        value: toBeHex(value),
        data: data,
        operation,
        safeTxGas: toBeHex(0),
        baseGas: toBeHex(0),
        gasPrice: toBeHex(0),
        gasToken: ZeroAddress,
        refundReceiver: ZeroAddress,
        nonce: toBeHex(op.nonce || state.nonce || 0n)
    };
}
export function getSafeBroadcastTxn(op, state) {
    const exec = new Interface(execTransactionAbi);
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
export function sortByAddress(sortableKeys) {
    return sortableKeys.sort((a, b) => {
        const aBig = BigInt(a.addr.toLowerCase());
        const bBig = BigInt(b.addr.toLowerCase());
        return aBig < bBig ? -1 : aBig > bBig ? 1 : 0;
    });
}
export function getSafeTxnHash(typedData) {
    return `0x${TypedDataUtils.eip712Hash(adaptTypedMessageForMetaMaskSigUtil({ ...typedData }), SignTypedDataVersion.V4).toString('hex')}`;
}
export async function propose(txn, chainId, safeAddress, owner, ownerSig, safeTxHash) {
    const apiKit = new SafeApiKit({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    const proposeTransactionProps = {
        safeAddress: getAddress(safeAddress),
        safeTxHash: safeTxHash,
        safeTransactionData: {
            ...txn,
            to: getAddress(txn.to),
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
export async function confirm(chainId, ownerSig, safeTxHash) {
    const apiKit = new SafeApiKit({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.confirmTransaction(safeTxHash, ownerSig);
}
export async function addMessage(chainId, safeAddress, message, signature) {
    const apiKit = new SafeApiKit({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.addMessage(safeAddress, {
        message,
        signature
    });
}
export async function getMessage({ chainId, threshold, messageHash }) {
    const apiKit = new SafeApiKit({
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
export async function addMessageSignature(chainId, hash, signature) {
    const apiKit = new SafeApiKit({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.addMessageSignature(hash, signature);
}
export async function getPendingTransactions(chainId, safeAddress) {
    const apiKit = new SafeApiKit({
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
export async function getLatestMessages(chainId, safeAddress) {
    const apiKit = new SafeApiKit({
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
export async function getTransaction(chainId, safeTxnHash) {
    const apiKit = new SafeApiKit({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
    return apiKit.getTransaction(safeTxnHash);
}
export async function fetchAllPending(networks, safeAddr) {
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
    const bytes = getBytes(transactionsHex);
    let i = 0;
    const results = [];
    while (i < bytes.length) {
        const operation = bytes[i];
        i += 1;
        const to = hexlify(bytes.slice(i, i + 20));
        i += 20;
        const value = BigInt(hexlify(bytes.slice(i, i + 32)));
        i += 32;
        const dataLength = Number(BigInt(hexlify(bytes.slice(i, i + 32))));
        i += 32;
        const data = hexlify(bytes.slice(i, i + dataLength));
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
export function toCallsUserRequest(safeAddr, response) {
    const userRequests = [];
    Object.keys(response).forEach((chainId) => {
        const txns = response[chainId].txns;
        txns.forEach((txn) => {
            let calls = [];
            try {
                // try to decode the data to check if it's a batch
                // if it is, use it; otherwise, construct a single call reqx
                const multisendInterface = new Interface(multiCallAbi);
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
                ? concat(txn.confirmations?.map((c) => c.signature))
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
export function toSigMessageUserRequests(response) {
    const userRequests = [];
    Object.keys(response).forEach((chainId) => {
        const messages = response[chainId].messages;
        messages.forEach((message) => {
            const signature = message.confirmations
                ? concat(message.confirmations.map((c) => c.signature))
                : null;
            if (!signature)
                return;
            userRequests.push({
                type: 'safeSignMessageRequest',
                params: {
                    chainId: BigInt(chainId),
                    signed: message.confirmations.map((confirm) => confirm.owner),
                    message: typeof message.message === 'string'
                        ? hexlify(toUtf8Bytes(message.message))
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
    return recoverAddress(hash, sig);
}
// the signature is 130 x number_of_sigs + 2 (0x) symbols long
// so we cut the hex (0x) from the beginning
// then take each sig (substring(0, 130)) and recover the address
// finally, we update everything
export function getAlreadySignedOwners(signature, hash, safeTx) {
    const signatures = signature.substring(2);
    const signed = [];
    for (let i = 0; i < signatures.length; i += 130) {
        const sig = `0x${signatures.substring(i, i + 130)}`;
        signed.push(recoverOwner(sig, hash, safeTx?.confirmations));
    }
    return signed;
}
export function getImportedSignersThatHaveNotSigned(signed, importedOwners) {
    return importedOwners.filter((o) => !signed.includes(o));
}
export function getSigs(signature) {
    if (!signature)
        return [];
    const signed = [];
    const signatures = signature.substring(2);
    for (let i = 0; i < signatures.length; i += 130) {
        signed.push(`0x${signatures.substring(i, i + 130)}`);
    }
    return signed;
}
export function sortSigs(signatures, hash, confirmations) {
    const signed = [];
    for (let i = 0; i < signatures.length; i++) {
        const sig = signatures[i];
        signed.push({ sig, addr: recoverOwner(sig, hash, confirmations) });
    }
    const sorted = sortByAddress(signed);
    return concat(sorted.map((s) => s.sig));
}
/**
 * Safe requests may have multiple "call" ones with the same nonce
 */
export function getSameNonceRequests(requests) {
    return requests.reduce((acc, r) => {
        const key = r.signAccountOp.accountOp.nonce?.toString() || '0';
        if (!acc[key]) {
            acc[key] = [];
        }
        acc[key].push(r);
        return acc;
    }, {});
}
export async function fetchExecutedTransactions(txns) {
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
            await wait(1100);
            promises = [];
        }
    }
    return results;
}
export async function getNonce(safeAddr, provider) {
    const safeInterface = new Contract(safeAddr, SafeAbi, provider);
    return safeInterface.nonce();
}
//# sourceMappingURL=safe.js.map