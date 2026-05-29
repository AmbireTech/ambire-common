import { getAddress, Interface, ZeroAddress } from 'ethers';
export const HYPER_EVM_CHAIN_ID = 999n;
const HYPER_EVM_TRACE_CONCURRENCY = 3;
const TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)'];
const transferInterface = new Interface(TRANSFER_ABI);
const isUsableTokenResult = (error, token) => !!token && error === '0x' && !!token.symbol;
const buildTokenBalanceMap = (tokensWithErrors) => tokensWithErrors.reduce((acc, [error, token]) => {
    if (!isUsableTokenResult(error, token))
        return acc;
    acc.set(token.address.toLowerCase(), token);
    return acc;
}, new Map());
const getBalanceChangeTokenAddresses = (tokenAddrs) => Array.from(new Set([ZeroAddress, ...tokenAddrs].map((tokenAddr) => {
    try {
        return getAddress(tokenAddr);
    }
    catch (e) {
        return null;
    }
}))).filter((addr) => addr !== null);
const getHexValue = (value) => {
    try {
        return value ? BigInt(value) : 0n;
    }
    catch {
        return 0n;
    }
};
const getTransferLogBalanceChangeByToken = (logs, accountAddr) => {
    const balanceChangeByToken = new Map();
    const accAddr = getAddress(accountAddr);
    logs.forEach((log) => {
        try {
            const parsed = transferInterface.parseLog({ topics: [...log.topics], data: log.data });
            if (!parsed)
                return;
            const from = getAddress(parsed.args.from);
            const to = getAddress(parsed.args.to);
            if (from !== accAddr && to !== accAddr)
                return;
            const tokenAddr = getAddress(log.address);
            const prevBalanceChange = balanceChangeByToken.get(tokenAddr) || 0n;
            let balanceChange = prevBalanceChange;
            if (from === accAddr)
                balanceChange -= parsed.args.value;
            if (to === accAddr)
                balanceChange += parsed.args.value;
            balanceChangeByToken.set(tokenAddr, balanceChange);
        }
        catch {
            // Not a standard ERC-20 Transfer log or not a checksummed EVM address.
        }
    });
    return balanceChangeByToken;
};
const getNativeBalanceChangeFromTrace = (trace, accountAddr) => {
    const traceType = trace.type?.toUpperCase();
    const valueMovesNativeBalance = ['CALL', 'CREATE', 'CREATE2', 'SELFDESTRUCT'].includes(traceType || '');
    let balanceChange = 0n;
    if (valueMovesNativeBalance) {
        const value = getHexValue(trace.value);
        try {
            if (trace.from && getAddress(trace.from) === accountAddr)
                balanceChange -= value;
            if (trace.to && getAddress(trace.to) === accountAddr)
                balanceChange += value;
        }
        catch {
            // Ignore malformed trace addresses.
        }
    }
    return (trace.calls || []).reduce((acc, call) => acc + getNativeBalanceChangeFromTrace(call, accountAddr), balanceChange);
};
const getReceiptFee = (receipt) => {
    if (receipt.fee !== undefined)
        return receipt.fee;
    if (receipt.gasUsed !== undefined && receipt.gasPrice !== undefined) {
        return receipt.gasUsed * receipt.gasPrice;
    }
    return 0n;
};
const mapWithConcurrency = async (items, concurrency, mapper) => {
    const results = new Array(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex]);
        }
    });
    await Promise.all(workers);
    return results;
};
const getHyperEvmNativeBalanceChange = async ({ accountAddr, receipts, debugTraceTransaction }) => {
    if (!receipts?.length || !debugTraceTransaction)
        return 0n;
    const checksummedAccountAddr = getAddress(accountAddr);
    const balanceChanges = await mapWithConcurrency(receipts, HYPER_EVM_TRACE_CONCURRENCY, async (receipt) => {
        if (!receipt.hash) {
            throw new Error('Missing transaction hash for HyperEVM native balance change trace');
        }
        const trace = await debugTraceTransaction(receipt.hash).catch((error) => {
            throw new Error(`Failed to trace HyperEVM transaction ${receipt.hash}: ${error?.message || error}`);
        });
        if (!trace) {
            throw new Error(`Missing trace result for HyperEVM transaction ${receipt.hash}`);
        }
        let balanceChange = getNativeBalanceChangeFromTrace(trace, checksummedAccountAddr);
        const transactionSender = receipt.from || trace.from;
        if (transactionSender && getAddress(transactionSender) === checksummedAccountAddr) {
            balanceChange -= getReceiptFee(receipt);
        }
        return balanceChange;
    });
    return balanceChanges.reduce((acc, balanceChange) => acc + balanceChange, 0n);
};
export const getHyperEvmBalanceChanges = async ({ accountAddr, chainId, getTokenBalancesOnBlock, receipts, debugTraceTransaction }) => {
    if (!receipts?.length)
        return [];
    const balanceChangeByToken = getTransferLogBalanceChangeByToken(receipts.flatMap((receipt) => receipt.logs), accountAddr);
    const nativeBalanceChange = await getHyperEvmNativeBalanceChange({
        accountAddr,
        receipts,
        debugTraceTransaction
    });
    const erc20TokenAddrs = getBalanceChangeTokenAddresses(Array.from(balanceChangeByToken.keys())).filter((tokenAddr) => tokenAddr !== ZeroAddress);
    const tokenAddrs = nativeBalanceChange !== 0n ? [ZeroAddress, ...erc20TokenAddrs] : erc20TokenAddrs;
    if (!tokenAddrs.length)
        return [];
    const latestTokensWithErrors = await getTokenBalancesOnBlock(accountAddr, chainId, tokenAddrs, 'latest', accountAddr);
    const latestTokens = buildTokenBalanceMap(latestTokensWithErrors);
    return tokenAddrs.reduce((changes, tokenAddr) => {
        const token = latestTokens.get(tokenAddr.toLowerCase());
        const balanceChange = tokenAddr === ZeroAddress ? nativeBalanceChange : balanceChangeByToken.get(tokenAddr) || 0n;
        if (!token || balanceChange === 0n)
            return changes;
        const amountAfter = token.amount;
        const amountBefore = amountAfter - balanceChange;
        changes.push({
            ...token,
            amount: amountAfter,
            amountBefore,
            amountAfter,
            balanceChange,
            priceIn: token.priceIn || [],
            marketDataIn: token.marketDataIn || []
        });
        return changes;
    }, []);
};
//# sourceMappingURL=hyperEvmBalanceChanges.js.map