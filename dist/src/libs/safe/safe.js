"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiKit = getApiKit;
exports.getSafeAccountByOwner = getSafeAccountByOwner;
exports.getCalculatedSafeAddress = getCalculatedSafeAddress;
exports.hasCompleteSafeCreationData = hasCompleteSafeCreationData;
exports.findDeployData = findDeployData;
exports.getSafeDeploymentCall = getSafeDeploymentCall;
exports.decodeSetupData = decodeSetupData;
exports.sortByAddress = sortByAddress;
exports.getSafeTxnHash = getSafeTxnHash;
exports.propose = propose;
exports.confirm = confirm;
exports.addMessage = addMessage;
exports.normalizeSafeGlobalMessage = normalizeSafeGlobalMessage;
exports.getMessage = getMessage;
exports.addMessageSignature = addMessageSignature;
exports.getPendingTransactions = getPendingTransactions;
exports.getLatestMessages = getLatestMessages;
exports.fetchAllPending = fetchAllPending;
exports.toCallsUserRequest = toCallsUserRequest;
exports.toSigMessageUserRequests = toSigMessageUserRequests;
exports.getAlreadySignedOwners = getAlreadySignedOwners;
exports.getImportedSignersThatHaveNotSigned = getImportedSignersThatHaveNotSigned;
exports.canHotOwnersMeetSafeThreshold = canHotOwnersMeetSafeThreshold;
exports.getSigs = getSigs;
exports.sortSigs = sortSigs;
exports.fetchExecutedTransactions = fetchExecutedTransactions;
exports.getNonce = getNonce;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const eth_sig_util_1 = require("@metamask/eth-sig-util");
const api_kit_1 = tslib_1.__importDefault(require("@safe-global/api-kit"));
const Safe_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/Safe.json"));
const safe_1 = require("../../consts/safe");
const paginate_1 = require("../../utils/paginate");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const with_timeout_1 = require("../../utils/with-timeout");
const signMessage_1 = require("../signMessage/signMessage");
const helpers_1 = require("./helpers");
function getApiKit(chainId) {
    return new api_kit_1.default({
        chainId,
        apiKey: process.env.SAFE_API_KEY
    });
}
async function getSafeAccountByOwner(safeAddr, owner, deployedOn, apiKitFactory = getApiKit) {
    const getAccountFromChain = async ([chainId, ...remainingChainIds], hasRequestFailed = false) => {
        if (chainId === undefined)
            return { account: null, failed: hasRequestFailed };
        const apiKit = apiKitFactory(chainId);
        try {
            const safeInfo = await (0, with_timeout_1.withTimeout)(() => apiKit.getSafeInfo(safeAddr), {
                timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
                message: `Safe API: get Safe info timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
            });
            const address = (0, ethers_1.getAddress)(safeAddr.toLowerCase());
            const owners = safeInfo.owners.map((safeOwner) => (0, ethers_1.getAddress)(safeOwner.toLowerCase()));
            if (!owners.some((safeOwner) => safeOwner === owner)) {
                return getAccountFromChain(remainingChainIds, hasRequestFailed);
            }
            const safeCreationInfo = await (0, with_timeout_1.withTimeout)(() => apiKit.getSafeCreationInfo(safeAddr), {
                timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
                message: `Safe API: get Safe creation info timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
            });
            return {
                account: {
                    addr: address,
                    associatedKeys: owners,
                    initialPrivileges: owners.map((safeOwner) => [safeOwner, '0x01']),
                    creation: null,
                    safeCreation: {
                        factoryAddr: safeCreationInfo.factoryAddress,
                        singleton: safeCreationInfo.singleton,
                        setupData: safeCreationInfo.setupData,
                        saltNonce: safeCreationInfo.saltNonce
                            ? (0, ethers_1.toBeHex)(BigInt(safeCreationInfo.saltNonce), 32)
                            : (0, ethers_1.toBeHex)(0, 32)
                    },
                    preferences: {
                        label: 'Safe',
                        pfp: address
                    },
                    deployedOn
                },
                failed: false
            };
        }
        catch (error) {
            console.error(`Failed to retrieve Safe account ${safeAddr} on network ${chainId.toString()}`, error);
            return getAccountFromChain(remainingChainIds, true);
        }
    };
    return getAccountFromChain(deployedOn);
}
async function getCalculatedSafeAddress(creation, provider) {
    return getCalculatedSafeAddressFromCreation({
        factoryAddr: creation.factoryAddress,
        singleton: creation.singleton,
        setupData: creation.setupData,
        saltNonce: (0, ethers_1.toBeHex)(BigInt(creation.saltNonce || 0), 32)
    }, provider);
}
async function getCalculatedSafeAddressFromCreation(creation, provider) {
    const salt = (0, ethers_1.keccak256)((0, ethers_1.concat)([(0, ethers_1.keccak256)(creation.setupData), (0, ethers_1.zeroPadValue)(creation.saltNonce, 32)]));
    const factoryAbi = ['function proxyCreationCode() view returns (bytes)'];
    const factory = new ethers_1.Contract(creation.factoryAddr, factoryAbi, provider);
    let proxyCreationCode;
    try {
        proxyCreationCode = await factory.proxyCreationCode();
    }
    catch (e) {
        console.error(`failed to call proxyCreationCode on Safe factory with addr: ${creation.factoryAddr}`, e);
        return null;
    }
    const abiCoder = new ethers_1.AbiCoder();
    const bytecode = (0, ethers_1.concat)([
        proxyCreationCode,
        abiCoder.encode(['address'], [creation.singleton])
    ]);
    return (0, ethers_1.getCreate2Address)(creation.factoryAddr, salt, (0, ethers_1.keccak256)(bytecode));
}
const safeProxyFactoryInterface = new ethers_1.Interface([
    'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce)',
    // v1.5.0+: calls createProxyWithNonce internally, so it uses the same salt and derives the
    // same address, which makes its deployment data reusable on other chains
    'function createProxyWithNonceL2(address _singleton, bytes initializer, uint256 saltNonce)'
]);
/**
 * Factory functions whose deployment data can be replayed on other chains. Chain specific and
 * callback deployments are intentionally excluded as they don't derive the same address elsewhere.
 */
const crossChainSafeDeployFunctions = ['createProxyWithNonce', 'createProxyWithNonceL2'];
const getSafeProxyFactorySelector = (functionName) => safeProxyFactoryInterface.getFunction(functionName).selector.slice(2);
const proxyCreationTopic = (0, ethers_1.id)('ProxyCreation(address,address)');
/** Returns whether all fields required to redeploy a Safe are available. */
function hasCompleteSafeCreationData(creation) {
    return !!(creation?.factoryAddr &&
        creation.factoryAddr !== '0x' &&
        creation.singleton &&
        creation.singleton !== '0x' &&
        creation.setupData &&
        creation.setupData !== '0x' &&
        creation.saltNonce &&
        creation.saltNonce !== '0x');
}
function decodeSafeDeploymentCalls(transactionData, factoryAddr, functionName) {
    const safeProxyFactorySelector = getSafeProxyFactorySelector(functionName);
    const normalizedTransactionData = transactionData.toLowerCase();
    const deploymentData = [];
    let selectorIndex = normalizedTransactionData.indexOf(safeProxyFactorySelector);
    while (selectorIndex !== -1) {
        try {
            const [singleton, setupData, saltNonce] = safeProxyFactoryInterface.decodeFunctionData(functionName, `0x${transactionData.slice(selectorIndex)}`);
            deploymentData.push({
                factoryAddr,
                singleton: (0, ethers_1.getAddress)(singleton),
                setupData: (0, ethers_1.hexlify)(setupData),
                saltNonce: (0, ethers_1.toBeHex)(saltNonce, 32)
            });
        }
        catch {
            // The selector can occur in unrelated calldata. Continue looking for a valid deployment call.
        }
        selectorIndex = normalizedTransactionData.indexOf(safeProxyFactorySelector, selectorIndex + safeProxyFactorySelector.length);
    }
    return deploymentData;
}
function decodeSafeDeploymentData(transactionData, factoryAddr) {
    return crossChainSafeDeployFunctions.flatMap((functionName) => decodeSafeDeploymentCalls(transactionData, factoryAddr, functionName));
}
/**
 * Finds the Safe factory that deployed safeAddr. Uses transaction.to when the factory was called
 * directly; otherwise locates the ProxyCreation event emitted for safeAddr in the deploy receipt,
 * which works regardless of how the factory call was wrapped (4337, MultiSend, relayers, etc.)
 */
async function findFactoryAddr(transaction, safeAddr, provider) {
    // lucky guess: if the call is to the factory, just take it directly
    if (transaction.to &&
        crossChainSafeDeployFunctions.some((functionName) => transaction.data.toLowerCase().startsWith(`0x${getSafeProxyFactorySelector(functionName)}`))) {
        return (0, ethers_1.getAddress)(transaction.to);
    }
    // take the receipt, find the deploy log and take the factory from there
    const receipt = await provider.getTransactionReceipt(transaction.hash).catch((e) => e);
    if (receipt instanceof Error) {
        console.error('failed to fetch the Safe deploy receipt', receipt);
        return null;
    }
    if (!receipt)
        return null;
    const paddedSafeAddr = (0, ethers_1.zeroPadValue)(safeAddr, 32).toLowerCase();
    const proxyCreationLog = receipt.logs.find((log) => log.topics[0] === proxyCreationTopic &&
        // v1.4.1+ indexes proxy (topics[1]); v1.3.0 has it as the first word of data
        (log.topics[1]?.toLowerCase() === paddedSafeAddr ||
            log.data.toLowerCase().startsWith(paddedSafeAddr)));
    return proxyCreationLog ? (0, ethers_1.getAddress)(proxyCreationLog.address) : null;
}
/**
 * Returns the Safe creation data available from the Safe Transaction Service, recovering missing
 * fields from the validated deployment transaction when possible.
 */
async function findDeployData(safeAddr, chainId, provider, apiKitFactory = getApiKit) {
    const creationInfo = await (0, with_timeout_1.withTimeout)(() => apiKitFactory(chainId).getSafeCreationInfo(safeAddr), {
        timeoutMs: safe_1.SAFE_API_TIMEOUT_MS,
        message: `Safe API: get Safe creation info timed out after ${safe_1.SAFE_API_TIMEOUT_MS}ms`
    }).catch((e) => e);
    // on timeout or problems with the Safe API, return an error
    // the caller should not proceed in this case
    if (creationInfo instanceof Error)
        return creationInfo;
    const safeCreation = {
        factoryAddr: (creationInfo.factoryAddress || '0x'),
        singleton: (creationInfo.singleton || '0x'),
        setupData: (creationInfo.setupData || '0x'),
        saltNonce: creationInfo.saltNonce !== null && creationInfo.saltNonce !== undefined
            ? (0, ethers_1.toBeHex)(BigInt(creationInfo.saltNonce), 32)
            : '0x'
    };
    if (hasCompleteSafeCreationData(safeCreation))
        return safeCreation;
    // if there's no transactionHash, we cannot find additional data,
    // but we pass back the found safeCreation until now
    if (!creationInfo.transactionHash)
        return safeCreation;
    const transaction = await provider
        .getTransaction(creationInfo.transactionHash)
        .catch((e) => e);
    // if the provider step fails, we cannot add additional data,
    // but we still pass back the found safeCreation until now
    if (transaction instanceof Error || !transaction?.data)
        return safeCreation;
    // if factoryAddr is missing for whatever reason, try to locate it
    // from the transaction itself
    let factoryAddr = safeCreation.factoryAddr;
    if (factoryAddr === '0x') {
        factoryAddr = (await findFactoryAddr(transaction, safeAddr, provider)) ?? '0x';
    }
    // if we cannot locate the factoryAddr, we return the data and move on
    if (factoryAddr === '0x')
        return safeCreation;
    factoryAddr = (0, ethers_1.getAddress)(factoryAddr);
    const deploymentData = decodeSafeDeploymentData(transaction.data, factoryAddr);
    for (const candidate of deploymentData) {
        const calculatedAddress = await getCalculatedSafeAddressFromCreation(candidate, provider);
        if (calculatedAddress?.toLowerCase() !== safeAddr.toLowerCase())
            continue;
        return candidate;
    }
    return safeCreation;
}
/**
 * Builds a Safe deployment call only when the stored creation data derives the imported address
 * and the configured singleton is deployed on the target network.
 */
async function getSafeDeploymentCall(account, provider) {
    if (!account.safeCreation)
        return null;
    try {
        const calculatedAddress = await getCalculatedSafeAddressFromCreation(account.safeCreation, provider);
        if (!calculatedAddress || calculatedAddress.toLowerCase() !== account.addr.toLowerCase()) {
            return null;
        }
        const singletonCode = await provider.getCode(account.safeCreation.singleton);
        if (singletonCode === '0x')
            return null;
        return {
            to: account.safeCreation.factoryAddr,
            value: 0n,
            data: safeProxyFactoryInterface.encodeFunctionData('createProxyWithNonce', [
                account.safeCreation.singleton,
                account.safeCreation.setupData,
                account.safeCreation.saltNonce
            ])
        };
    }
    catch (error) {
        console.error(`failed to build Safe deployment call for ${account.addr}`, error);
        return null;
    }
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
        console.error('failed to decode the Safe setup data', e);
        return [];
    }
    return Object.keys(decoded[0]).map((key) => decoded[0][key]);
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
    const apiKit = getApiKit(chainId);
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
    const apiKit = getApiKit(chainId);
    return apiKit.confirmTransaction(safeTxHash, ownerSig);
}
async function addMessage(chainId, safeAddress, message, signature, origin) {
    const apiKit = getApiKit(chainId);
    // `origin` is a free-form field the Safe Transaction Service persists and returns
    // on the message. api-kit doesn't type it, but it forwards the options as the POST
    // body verbatim, so we widen the payload to carry it through.
    const options = {
        message: normalizeSafeGlobalMessage(message),
        signature
    };
    if (origin)
        options.origin = origin;
    return apiKit.addMessage(safeAddress, options);
}
function normalizeSafeGlobalMessage(message) {
    if (typeof message === 'string')
        return message;
    const chainId = message.domain.chainId;
    if (typeof chainId !== 'bigint')
        return message;
    return {
        ...message,
        domain: {
            ...message.domain,
            chainId: chainId.toString()
        }
    };
}
async function getMessage({ chainId, threshold, messageHash }) {
    const apiKit = getApiKit(chainId);
    const msg = await apiKit.getMessage(messageHash).catch((e) => {
        console.log('safe message not found', e);
        return null;
    });
    if (!msg)
        return null;
    return {
        ...msg,
        isConfirmed: msg.confirmations.length >= threshold
    };
}
async function addMessageSignature(chainId, hash, signature) {
    const apiKit = getApiKit(chainId);
    return apiKit.addMessageSignature(hash, signature);
}
async function getPendingTransactions(chainId, safeAddress) {
    const apiKit = getApiKit(chainId);
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
    const apiKit = getApiKit(chainId);
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
function toCallsUserRequest(safeAddr, response) {
    const userRequests = [];
    Object.keys(response).forEach((chainId) => {
        const txns = response[chainId].txns;
        txns.forEach((txn) => {
            let calls = [];
            try {
                // try to decode the data to check if it's a batch
                // if it is, use it; otherwise, construct a single call reqx
                const multisendInterface = new ethers_1.Interface(helpers_1.multiCallAbi);
                const multiSendCall = multisendInterface.decodeFunctionData('multiSend', txn.data);
                const decodedCalls = (0, helpers_1.decodeMultiSend)(multiSendCall[0]);
                if (!decodedCalls.every((call) => call.success)) {
                    throw new Error('failed to decode one or more multiSend calls');
                }
                calls = decodedCalls.map((call) => ({
                    to: call.to,
                    value: call.value,
                    data: call.data
                }));
            }
            catch {
                // this just means it's not a batch
                calls = [{ to: txn.to, value: BigInt(txn.value), data: txn.data || '0x' }];
            }
            const signature = txn.confirmations
                ? sortSigs(txn.confirmations.map((c) => c.signature), txn.safeTxHash, txn.confirmations)
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
            const { name: dappName, url: dappUrl } = (0, helpers_1.parseSafeMessageOrigin)(message.origin);
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
                    signatures: message.confirmations.map((c) => c.signature),
                    dappName,
                    dappUrl
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
/**
 * Whether the imported owners of a Safe can reach its threshold with hot (keystore held) keys
 * alone. Hardware wallets and cards confirm on the device, so they do not count towards it.
 */
function canHotOwnersMeetSafeThreshold(importedOwners, threshold) {
    return importedOwners.filter(({ type }) => type === 'internal').length >= threshold;
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
 * Fetch the Safe transactions of an account on each of the passed chains.
 * `minNonce` is the smallest nonce we are still waiting on for that chain -
 * transactions below it can no longer execute, so the API does not have to
 * return them.
 */
async function fetchExecutedTransactions(safeAddr, chains) {
    const results = [];
    const pages = (0, paginate_1.paginate)(chains, 3);
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        // we're allowed a max of 5 req to the API per second so we
        // have to be careful - making 3 at a time from here
        const responses = await Promise.all(page.map(async ({ chainId, minNonce }) => {
            const apiKit = getApiKit(chainId);
            // @TODO this method can be used to get safe tx history
            // @TODO make rate limit tracking for the whole library
            // Cut the response size down: the account may have a long history, but
            // everything below minNonce can no longer execute, so it cannot resolve a
            // request we are waiting on. The double underscore is the filter syntax of
            // the Safe Transaction Service, not a typo
            const res = await apiKit
                .getMultisigTransactions(safeAddr, {
                ordering: 'nonce',
                nonce__gte: minNonce
            })
                .catch((error) => {
                console.log(`failed to call getMultisigTransactions on ${chainId}`, error);
                return null;
            });
            return res;
        }));
        responses
            .filter((response) => response !== null)
            .forEach(({ results: txns }) => {
            txns.forEach((tx) => {
                if (tx.transactionHash) {
                    results.push({
                        safeTxnHash: tx.safeTxHash,
                        transactionHash: tx.transactionHash,
                        nonce: tx.nonce
                    });
                }
                else {
                    results.push({
                        safeTxnHash: tx.safeTxHash,
                        nonce: tx.nonce,
                        confirmations: tx.confirmations
                    });
                }
            });
        });
        // no need to throttle after the last page, nothing follows it
        if (i + 1 < pages.length)
            await (0, wait_1.default)(1100);
    }
    return results;
}
async function getNonce(safeAddr, provider) {
    const safeInterface = new ethers_1.Contract(safeAddr, Safe_json_1.default, provider);
    return safeInterface.nonce();
}
//# sourceMappingURL=safe.js.map