import { Interface, isAddress, toBeHex, ZeroAddress } from 'ethers';
import { getAvailableBunlders, getBundlerByName, getDefaultBundler } from '../../services/bundlers/getBundler';
import wait from '../../utils/wait';
import { AccountOpStatus } from './types';
export function isIdentifiedByTxn(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'Transaction';
}
export function isIdentifiedByUserOpHash(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'UserOperation';
}
export function isIdentifiedByRelayer(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'Relayer';
}
export function isIdentifiedByMultipleTxn(identifiedBy) {
    return identifiedBy && identifiedBy.type === 'MultipleTxns';
}
export function getDappIdentifier(op) {
    let hash = `${op.identifiedBy.type}:${op.identifiedBy.identifier}`;
    if (op.identifiedBy?.bundler)
        hash = `${hash}:${op.identifiedBy.bundler}`;
    return hash;
}
export function getMultipleBroadcastUnconfirmedCallOrLast(op) {
    let lastWithTxId;
    let callIndex = 0;
    // get the first BroadcastedButNotConfirmed call if any
    for (let i = 0; i < op.calls.length; i++) {
        const currentCall = op.calls[i];
        if (currentCall.status === AccountOpStatus.BroadcastedButNotConfirmed)
            return { call: currentCall, callIndex: i };
        lastWithTxId = currentCall;
        callIndex = i;
    }
    // if no BroadcastedButNotConfirmed, get the last one
    return { call: lastWithTxId, callIndex };
}
export async function fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter = 0) {
    // try to find the probably front ran txn id 5 times and if it can't,
    // return the already found one. It could've really failed
    if (counter >= 5)
        return foundTxnId;
    const userOpHash = identifiedBy.identifier;
    const bundler = getDefaultBundler(network); // rely on pimlico for front running
    const bundlerResult = await bundler.getReceipt(userOpHash, network);
    if (!bundlerResult.receipt ||
        bundlerResult.receipt.transactionHash.toLowerCase() === foundTxnId.toLowerCase()) {
        await wait(2000);
        return fetchFrontRanTxnId(identifiedBy, foundTxnId, network, counter + 1);
    }
    return bundlerResult.receipt.transactionHash;
}
export function hasTimePassedSinceBroadcast(op, mins) {
    const accountOpDate = new Date(op.timestamp);
    accountOpDate.setMinutes(accountOpDate.getMinutes() + mins);
    return accountOpDate < new Date();
}
export async function fetchTxnId(identifiedBy, network, callRelayer, op) {
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
            ? getBundlerByName(identifiedBy.bundler)
            : getDefaultBundler(network);
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
                await wait(10000);
            const bundlers = getAvailableBunlders(network);
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
export function updateOpStatus(
// IMPORTANT: pass a reference to this.#accountsOps[accAddr][chainId][index]
// so we could mutate it from inside this method
opReference, status, receipt) {
    if (opReference.identifiedBy.type === 'MultipleTxns') {
        const callIndex = getMultipleBroadcastUnconfirmedCallOrLast(opReference).callIndex;
        opReference.calls[callIndex].status = status;
        // if there's a receipt, add the fee
        if (receipt) {
            opReference.calls[callIndex].fee = {
                inToken: ZeroAddress,
                amount: receipt.fee
            };
            opReference.calls[callIndex].blockHash = receipt.blockHash;
            opReference.calls[callIndex].blockNumber = receipt.blockNumber;
            opReference.calls[callIndex].blockHash = receipt.blockHash;
            opReference.calls[callIndex].gasUsed = toBeHex(receipt.gasUsed);
        }
        const left = !!opReference.calls.find((c) => c.status === AccountOpStatus.BroadcastedButNotConfirmed);
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
const transferIface = new Interface(['function transfer(address,uint256)']);
/**
 * Returns all addresses that the SubmittedAccountOp has calls sent to.
 *
 * @param whitelist Optional list of addresses to filter the results.
 */
export function getAccountOpRecipients(op, whitelist) {
    const sentTo = new Set();
    const lowercaseWhitelist = whitelist?.map((addr) => addr.toLowerCase());
    op.calls.forEach((call) => {
        // 1) Direct call.to match
        if (call.to && isAddress(call.to)) {
            if (!lowercaseWhitelist || lowercaseWhitelist.includes(call.to.toLowerCase())) {
                sentTo.add(call.to);
            }
        }
        // 2) If this is an ERC-20 transfer(address,uint256), decode the recipient from call.data
        const data = call.data;
        if (!data || typeof data !== 'string' || data.length < 10)
            return;
        const selector = transferIface.getFunction('transfer')?.selector;
        if (selector && data.startsWith(selector)) {
            try {
                const decoded = transferIface.decodeFunctionData('transfer', data);
                const recipient = decoded[0];
                if (isAddress(recipient)) {
                    if (lowercaseWhitelist && !lowercaseWhitelist.includes(recipient.toLowerCase()))
                        return;
                    sentTo.add(recipient);
                }
            }
            catch {
                // ignore decode errors and continue
            }
        }
    });
    return Array.from(sentTo);
}
/**
 * Checks if the SubmittedAccountOp has a call that was sent to the specified address.
 *
 * @returns the timestamp of the operation if found, otherwise null.
 */
export function checkIsRecipientOfAccountOp(op, to) {
    const hasSentTo = getAccountOpRecipients(op, [to]).length > 0;
    if (!hasSentTo)
        return null;
    return op.timestamp;
}
//# sourceMappingURL=submittedAccountOp.js.map