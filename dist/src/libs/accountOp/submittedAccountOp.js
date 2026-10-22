"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCallsWithTxnIds = getCallsWithTxnIds;
exports.submittedAccountOpToAccountOp = submittedAccountOpToAccountOp;
exports.getSubmittedAccountOpNonce = getSubmittedAccountOpNonce;
exports.isIdentifiedByTxn = isIdentifiedByTxn;
exports.isIdentifiedByUserOpHash = isIdentifiedByUserOpHash;
exports.isIdentifiedByRelayer = isIdentifiedByRelayer;
exports.isIdentifiedByMultipleTxn = isIdentifiedByMultipleTxn;
exports.getDappIdentifier = getDappIdentifier;
exports.getMultipleBroadcastUnconfirmedCallOrLast = getMultipleBroadcastUnconfirmedCallOrLast;
exports.fetchFrontRanTxnId = fetchFrontRanTxnId;
exports.hasTimePassedSinceBroadcast = hasTimePassedSinceBroadcast;
exports.fetchTxnId = fetchTxnId;
exports.updateOpStatus = updateOpStatus;
exports.getAccountOpRecipients = getAccountOpRecipients;
exports.checkIsRecipientOfAccountOp = checkIsRecipientOfAccountOp;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const viem_1 = require("viem");
const getBundler_1 = require("../../services/bundlers/getBundler");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
const types_1 = require("./types");
/**
 * Adds to each call of a batch broadcast as one txn per call (`MultipleTxns`) the hash
 * of its txn. Calls without a txn were not sent (e.g. rejected on the hardware wallet
 * midway through the batch), so they are marked as rejected.
 */
function getCallsWithTxnIds(submittedAccountOp) {
    const txnIds = submittedAccountOp.identifiedBy.identifier.split('-');
    return submittedAccountOp.calls.map((oneCall, i) => {
        const localCall = { ...oneCall };
        // if there's no tx id, we set it to Rejected and continue.
        // it means broadcast has failed
        if (!(i in txnIds)) {
            localCall.status = types_1.AccountOpStatus.Rejected;
            return localCall;
        }
        localCall.txnId = txnIds[i];
        localCall.status = types_1.AccountOpStatus.BroadcastedButNotConfirmed;
        return localCall;
    });
}
/**
 * Rebuilds a full `AccountOp` from a `SubmittedAccountOpLike` - e.g. to re-run `humanizeAccountOp`
 * against a past activity item, which only carries the looser `SubmittedAccountOpLike` shape.
 * Fields absent from `SubmittedAccountOpLike` (because they were optional on
 * `SubmittedAccountOpActionFields`, or never persisted) fall back to `AccountOp`'s own defaults.
 */
function submittedAccountOpToAccountOp(submittedAccountOp) {
    return {
        id: submittedAccountOp.id,
        accountAddr: submittedAccountOp.accountAddr,
        chainId: submittedAccountOp.chainId,
        signingKeyAddr: submittedAccountOp.signingKeyAddr ?? null,
        signingKeyType: submittedAccountOp.signingKeyType ?? null,
        nonce: submittedAccountOp.nonce ?? null,
        eoaNonce: submittedAccountOp.eoaNonce,
        calls: submittedAccountOp.calls,
        feeCall: submittedAccountOp.feeCall,
        activatorCall: submittedAccountOp.activatorCall,
        gasLimit: submittedAccountOp.gasLimit ?? null,
        signature: submittedAccountOp.signature ?? null,
        gasFeePayment: submittedAccountOp.gasFeePayment,
        txnId: submittedAccountOp.txnId,
        status: submittedAccountOp.status,
        asUserOperation: submittedAccountOp.asUserOperation,
        signers: submittedAccountOp.signers,
        signed: submittedAccountOp.signed,
        safeTx: submittedAccountOp.safeTx,
        meta: submittedAccountOp.meta,
        flags: submittedAccountOp.flags
    };
}
/**
 * Returns the account-level nonce to store in Activity. Safe transactions broadcast through a
 * bundler have an unrelated, random UserOperation nonce, which remains available on
 * `accountOp.asUserOperation.nonce` and must not replace the Safe transaction nonce.
 */
function getSubmittedAccountOpNonce(accountOpNonce, broadcastNonce, isSafeAccount) {
    if (isSafeAccount && accountOpNonce !== null)
        return accountOpNonce;
    return BigInt(broadcastNonce);
}
function isIdentifiedByTxn(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'Transaction';
}
function isIdentifiedByUserOpHash(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'UserOperation';
}
function isIdentifiedByRelayer(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'Relayer';
}
function isIdentifiedByMultipleTxn(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'MultipleTxns';
}
function getDappIdentifier(op) {
    let hash = `${op.identifiedBy.type}:${op.identifiedBy.identifier}`;
    if (op.identifiedBy?.bundler)
        hash = `${hash}:${op.identifiedBy.bundler}`;
    return hash;
}
function getMultipleBroadcastUnconfirmedCallOrLast(op) {
    let lastWithTxId;
    let callIndex = 0;
    // get the first BroadcastedButNotConfirmed call if any
    for (let i = 0; i < op.calls.length; i++) {
        const currentCall = op.calls[i];
        if (currentCall.status === types_1.AccountOpStatus.BroadcastedButNotConfirmed)
            return { call: currentCall, callIndex: i };
        lastWithTxId = currentCall;
        callIndex = i;
    }
    // if no BroadcastedButNotConfirmed, get the last one
    return { call: lastWithTxId, callIndex };
}
async function fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter = 0) {
    // try to find the probably front ran txn id 5 times and if it can't,
    // return the already found one. It could've really failed
    if (counter >= 5)
        return foundTxnId;
    const userOpHash = identifiedBy.identifier;
    const bundler = (0, getBundler_1.getDefaultBundler)(network); // rely on pimlico for front running
    const bundlerResult = await bundler.getReceipt(userOpHash, network);
    if (!bundlerResult.receipt ||
        bundlerResult.receipt.transactionHash.toLowerCase() === foundTxnId.toLowerCase()) {
        await (0, wait_1.default)(2000);
        return fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter + 1);
    }
    return bundlerResult.receipt.transactionHash;
}
function hasTimePassedSinceBroadcast(op, mins) {
    const accountOpDate = new Date(op.timestamp);
    accountOpDate.setMinutes(accountOpDate.getMinutes() + mins);
    return accountOpDate < new Date();
}
async function fetchTxnId(identifiedBy, network, callRelayer, op) {
    if (isIdentifiedByTxn(identifiedBy))
        return {
            status: 'success',
            txnId: identifiedBy.identifier
        };
    if (isIdentifiedByMultipleTxn(identifiedBy)) {
        if (op) {
            return {
                status: 'success',
                txnId: getMultipleBroadcastUnconfirmedCallOrLast(op).call.txnId
            };
        }
        // always return the last txn id if no account op
        const txnIds = identifiedBy.identifier.split('-');
        return {
            status: 'success',
            txnId: txnIds[txnIds.length - 1]
        };
    }
    if (isIdentifiedByUserOpHash(identifiedBy)) {
        const userOpHash = identifiedBy.identifier;
        const bundler = identifiedBy.bundler
            ? (0, getBundler_1.getBundlerByName)(identifiedBy.bundler)
            : (0, getBundler_1.getDefaultBundler)(network);
        // leave a 10s window to fetch the status from the broadcasting bundler
        let timeoutId;
        const bundlerStatus = await Promise.race([
            bundler.getStatus(network, userOpHash),
            new Promise((_resolve, reject) => {
                timeoutId = setTimeout(() => reject(new Error('bundler gas price fetch fail, request too slow')), 10000);
            })
        ]).catch(() => {
            // upon error or timeout, we return not_found and we fallback to receipt
            // from all our available bundlers
            return {
                status: 'not_found'
            };
        });
        clearTimeout(timeoutId);
        let bundlerResult = bundlerStatus;
        // upon reject or failure to find/fetch, take the receipt from all available bundlers
        if (bundlerResult.status === 'rejected' || bundlerResult.status === 'not_found') {
            // sometimes the bundlers return rejected by mistake
            // if that's the case, make the user wait a bit longer, but then query
            // all bundlers for the user op receipt to make sure it's really not mined
            if (bundlerResult.status === 'rejected')
                await (0, wait_1.default)(10000);
            const bundlers = (0, getBundler_1.getAvailableBunlders)(network);
            const bundlerResults = await Promise.all(bundlers.map((b) => {
                let innerTimeoutId;
                const result = Promise.race([
                    b.getReceipt(userOpHash, network),
                    new Promise((_resolve, reject) => {
                        innerTimeoutId = setTimeout(() => reject(new Error('bundler gas price fetch fail, request too slow')), 10000);
                    })
                ])
                    .catch(() => {
                    // upon timeout or error, just return null and let the logic continue
                    return null;
                })
                    .finally(() => {
                    clearTimeout(innerTimeoutId);
                });
                return result;
            }));
            bundlerResults.forEach((bundlerResponse) => {
                const res = bundlerResponse;
                if (res && res.receipt && res.receipt.transactionHash) {
                    bundlerResult = {
                        status: 'found',
                        transactionHash: res.receipt.transactionHash
                    };
                }
            });
            // if it's rejected even after searching all the bundlers,
            // we return rejected
            if (bundlerResult.status === 'rejected') {
                return {
                    status: 'rejected',
                    txnId: null
                };
            }
        }
        if (bundlerResult.transactionHash)
            return {
                status: 'success',
                txnId: bundlerResult.transactionHash
            };
        return {
            status: 'not_found',
            txnId: null
        };
    }
    const id = identifiedBy.identifier;
    let response = null;
    try {
        response = await callRelayer(`/v2/get-txn-id/${id}`);
    }
    catch (e) {
        console.log(`relayer responded with an error when trying to find the txnId: ${e}`);
        return {
            status: 'not_found',
            txnId: null
        };
    }
    if (!response.data.txId) {
        if (op && op.txnId)
            return {
                status: 'success',
                txnId: op.txnId
            };
        return {
            status: 'not_found',
            txnId: null
        };
    }
    return {
        status: 'success',
        txnId: response.data.txId
    };
}
function updateOpStatus(
// IMPORTANT: pass a reference to this.#accountsOps[accAddr][chainId][index]
// so we could mutate it from inside this method
opReference, status, receipt) {
    if (opReference.identifiedBy.type === 'MultipleTxns') {
        const callIndex = getMultipleBroadcastUnconfirmedCallOrLast(opReference).callIndex;
        opReference.calls[callIndex].status = status;
        // if there's a receipt, add the fee
        if (receipt) {
            opReference.calls[callIndex].fee = {
                inToken: ethers_1.ZeroAddress,
                amount: receipt.fee
            };
            opReference.calls[callIndex].blockHash = receipt.blockHash;
            opReference.calls[callIndex].blockNumber = receipt.blockNumber;
            opReference.calls[callIndex].blockHash = receipt.blockHash;
            opReference.calls[callIndex].gasUsed = (0, ethers_1.toBeHex)(receipt.gasUsed);
        }
        const left = !!opReference.calls.find((c) => c.status === types_1.AccountOpStatus.BroadcastedButNotConfirmed);
        if (!left) {
            opReference.status = status;
            return opReference;
        }
        // returning null here means the accountOp as a whole is still not ready
        // to be updated as there are still pending transaction to be confirmed
        return null;
    }
    opReference.status = status;
    return opReference;
}
// `transferFrom(address,address,uint256)` is shared by ERC20 and ERC721, so one entry covers both
const transferAbi = (0, viem_1.parseAbi)(['function transfer(address to, uint256 amountOrTokenId)']);
const transferFromAbi = (0, viem_1.parseAbi)([
    'function transferFrom(address from, address to, uint256 amountOrTokenId)'
]);
const safeTransferFromAbi = (0, viem_1.parseAbi)([
    'function safeTransferFrom(address from, address to, uint256 tokenId)'
]);
const safeTransferFromWithDataAbi = (0, viem_1.parseAbi)([
    'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)'
]);
/**
 * Which decoded argument holds the recipient, per function that moves funds to someone else.
 * Everything not listed here is a contract interaction rather than a send.
 */
const RECIPIENT_ARG_INDEX_BY_SELECTOR = {
    [(0, viem_1.toFunctionSelector)(transferAbi[0])]: { abi: transferAbi, index: 0, args: 2 },
    [(0, viem_1.toFunctionSelector)(transferFromAbi[0])]: { abi: transferFromAbi, index: 1, args: 3 },
    [(0, viem_1.toFunctionSelector)(safeTransferFromAbi[0])]: { abi: safeTransferFromAbi, index: 1, args: 3 },
    [(0, viem_1.toFunctionSelector)(safeTransferFromWithDataAbi[0])]: {
        abi: safeTransferFromWithDataAbi,
        index: 1,
        args: 3
    }
};
const getRecipientFromCall = (call) => {
    const data = (call.data || '0x');
    // A plain value transfer - the call target is the recipient
    if (data === '0x')
        return call.value > 0n && call.to ? call.to : null;
    const decoder = RECIPIENT_ARG_INDEX_BY_SELECTOR[data.slice(0, 10)];
    if (!decoder)
        return null;
    try {
        // Some tokens send shorter calldata than the ABI expects, the same way the humanizer pads it
        const expectedLength = 2 + 8 + decoder.args * 64;
        const { args } = (0, viem_1.decodeFunctionData)({
            abi: decoder.abi,
            data: data.padEnd(expectedLength, '0')
        });
        return args[decoder.index] || null;
    }
    catch {
        // Not actually the function the selector suggests, so there is no recipient to read
        return null;
    }
};
/**
 * Returns the addresses an account op sends funds to - native transfers plus ERC20/ERC721
 * `transfer`, `transferFrom` and both `safeTransferFrom` overloads - checksummed, deduplicated
 * and in call order. Contract interactions are left out: calling a contract is not sending to it.
 *
 * @param whitelist Optional list of addresses to filter the results (case-insensitive).
 */
function getAccountOpRecipients(op, whitelist) {
    const domainByRecipient = new Map();
    const lowercaseWhitelist = whitelist?.map((addr) => addr.toLowerCase());
    op.calls.forEach((call) => {
        const recipient = getRecipientFromCall(call);
        if (!recipient)
            return;
        let address;
        try {
            address = (0, ethers_1.getAddress)(recipient);
        }
        catch {
            // A malformed address can never have been sent to, so it is not a recipient
            return;
        }
        if (lowercaseWhitelist && !lowercaseWhitelist.includes(address.toLowerCase()))
            return;
        const domain = call.recipientDomain?.toLowerCase()?.trim();
        if (domain || !domainByRecipient.has(address))
            domainByRecipient.set(address, domain || undefined);
    });
    return Array.from(domainByRecipient, ([address, domain]) => ({ address, domain }));
}
/**
 * Checks if the SubmittedAccountOp has a call that was sent to the specified address.
 *
 * @returns the timestamp of the operation if found, otherwise null.
 */
function checkIsRecipientOfAccountOp(op, to) {
    const hasSentTo = getAccountOpRecipients(op, [to]).length > 0;
    if (!hasSentTo)
        return null;
    return op.timestamp;
}
//# sourceMappingURL=submittedAccountOp.js.map