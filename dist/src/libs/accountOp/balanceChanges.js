"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccountOpBalanceChanges = exports.compareTokenBalances = exports.getBalanceChangeTokenAddresses = void 0;
const ethers_1 = require("ethers");
const hyperEvmBalanceChanges_1 = require("./hyperEvmBalanceChanges");
const ABSTRACT_CHAIN_ID = 2741n;
const ABSTRACT_NATIVE_TOKEN_ADDRESS = '0x000000000000000000000000000000000000800A';
const NATIVE_TOKEN_TRANSFER_LOG_ADDRESS = '0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE';
/**
 * Some native tokens emit ERC-20-shaped transfer logs from addresses that
 * aren't standard ERC-20 contracts. Exclude the universal native transfer
 * log address and Abstract's native token alias from ERC-20 balance checks.
 */
const filterNativeTokenAliases = (tokenAddrs, chainId) => tokenAddrs.filter((tokenAddr) => {
    const normalizedTokenAddr = tokenAddr.toLowerCase();
    if (normalizedTokenAddr === NATIVE_TOKEN_TRANSFER_LOG_ADDRESS.toLowerCase())
        return false;
    return (chainId !== ABSTRACT_CHAIN_ID ||
        normalizedTokenAddr !== ABSTRACT_NATIVE_TOKEN_ADDRESS.toLowerCase());
});
const getBalanceChangeTokenAddresses = (tokenAddrs, chainId) => {
    const tokenAddrsToNormalize = filterNativeTokenAliases(tokenAddrs, chainId);
    return Array.from(new Set([ethers_1.ZeroAddress, ...tokenAddrsToNormalize].map((tokenAddr) => {
        try {
            return (0, ethers_1.getAddress)(tokenAddr);
        }
        catch {
            return null;
        }
    }))).filter((addr) => addr !== null);
};
exports.getBalanceChangeTokenAddresses = getBalanceChangeTokenAddresses;
const isUsableTokenResult = (error, token) => !!token && error === '0x' && !!token.symbol;
const isNativeTokenAddress = (tokenAddr) => tokenAddr.toLowerCase() === ethers_1.ZeroAddress.toLowerCase();
const buildTokenBalanceMap = (tokensWithErrors) => tokensWithErrors.reduce((acc, [error, token]) => {
    if (!isUsableTokenResult(error, token))
        return acc;
    acc.set(token.address.toLowerCase(), token);
    return acc;
}, new Map());
const assertTokenBalanceSnapshot = (tokensWithErrors, tokenAddrs, blockNumber) => {
    const tokens = buildTokenBalanceMap(tokensWithErrors);
    const missingTokenAddrs = tokenAddrs.filter((tokenAddr) => !tokens.has(tokenAddr.toLowerCase()));
    if (missingTokenAddrs.length) {
        throw new Error(`Missing token balance snapshot for ${missingTokenAddrs.join(', ')} at block ${blockNumber}`);
    }
};
const compareTokenBalances = (beforeTokensWithErrors, afterTokensWithErrors) => {
    const beforeTokens = buildTokenBalanceMap(beforeTokensWithErrors);
    const afterTokens = buildTokenBalanceMap(afterTokensWithErrors);
    const tokenAddresses = new Set([...beforeTokens.keys(), ...afterTokens.keys()]);
    return Array.from(tokenAddresses).reduce((changes, tokenAddress) => {
        const beforeToken = beforeTokens.get(tokenAddress);
        const afterToken = afterTokens.get(tokenAddress);
        const referenceToken = afterToken || beforeToken;
        if (!referenceToken)
            return changes;
        const amountBefore = beforeToken?.amount || 0n;
        const amountAfter = afterToken?.amount || 0n;
        const balanceChange = amountAfter - amountBefore;
        if (balanceChange === 0n)
            return changes;
        changes.push({
            ...referenceToken,
            amount: amountAfter,
            amountBefore,
            amountAfter,
            balanceChange,
            priceIn: referenceToken.priceIn || [],
            marketDataIn: referenceToken.marketDataIn || []
        });
        return changes;
    }, []);
};
exports.compareTokenBalances = compareTokenBalances;
const getAccountOpBalanceChanges = async ({ accountAddr, chainId, tokenAddrs, receiptBlockNumber, getTokenBalancesOnBlock, prevBlockNumber, receipts, debugTraceTransaction }) => {
    if (chainId === hyperEvmBalanceChanges_1.HYPER_EVM_CHAIN_ID) {
        // HyperEVM's public RPC only supports latest-state eth_call/getBalance, so
        // historical balance reads fail. Receipt logs still give exact ERC-20 deltas.
        return (0, hyperEvmBalanceChanges_1.getHyperEvmBalanceChanges)({
            accountAddr,
            chainId,
            getTokenBalancesOnBlock,
            receipts,
            debugTraceTransaction
        });
    }
    const balanceChangeTokenAddrs = filterNativeTokenAliases(tokenAddrs, chainId);
    const previousBlockNumber = prevBlockNumber
        ? prevBlockNumber
        : receiptBlockNumber > 0
            ? receiptBlockNumber - 1
            : 0;
    const [currentBlockTokens, previousBlockTokens] = await Promise.all([
        getTokenBalancesOnBlock(accountAddr, chainId, balanceChangeTokenAddrs, receiptBlockNumber, accountAddr),
        getTokenBalancesOnBlock(accountAddr, chainId, balanceChangeTokenAddrs, previousBlockNumber, accountAddr)
    ]);
    // The receipt block snapshot must include every token, otherwise we could
    // falsely record a full-balance outflow. On the previous block, native is
    // still required, but missing ERC-20s are allowed as 0 -> current balance.
    assertTokenBalanceSnapshot(currentBlockTokens, balanceChangeTokenAddrs, receiptBlockNumber);
    assertTokenBalanceSnapshot(previousBlockTokens, balanceChangeTokenAddrs.filter(isNativeTokenAddress), previousBlockNumber);
    return (0, exports.compareTokenBalances)(previousBlockTokens, currentBlockTokens);
};
exports.getAccountOpBalanceChanges = getAccountOpBalanceChanges;
//# sourceMappingURL=balanceChanges.js.map