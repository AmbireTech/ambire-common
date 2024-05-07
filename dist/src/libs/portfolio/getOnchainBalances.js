"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokens = exports.getNFTs = void 0;
const deployless_1 = require("../deployless/deployless");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
// 0x00..01 is the address from which simulation signatures are valid
const DEPLOYLESS_SIMULATION_FROM = '0x0000000000000000000000000000000000000001';
const handleSimulationError = (error, beforeNonce, afterNonce) => {
    if (error !== '0x')
        throw new SimulationError((0, deployless_1.parseErr)(error) || error, beforeNonce, afterNonce);
    // If the afterNonce is 0, it means that we reverted, even if the error is empty
    // In both BalanceOracle and NFTOracle, afterSimulation and therefore afterNonce will be left empty
    if (afterNonce === 0n)
        throw new SimulationError('unknown error: simulation reverted', beforeNonce, afterNonce);
    if (afterNonce < beforeNonce)
        throw new SimulationError('lower "after" nonce, should not be possible', beforeNonce, afterNonce);
};
async function getNFTs(deployless, opts, accountAddr, tokenAddrs, limits) {
    const deploylessOpts = { blockTag: opts.blockTag, from: DEPLOYLESS_SIMULATION_FROM };
    const mapToken = (token) => {
        return {
            name: token.name,
            symbol: token.symbol,
            amount: BigInt(token.nfts.length),
            decimals: 1,
            collectibles: [...token.nfts].map((token) => ({ id: token.id, url: token.uri }))
        };
    };
    if (!opts.simulation) {
        const collections = (await deployless.call('getAllNFTs', [
            accountAddr,
            tokenAddrs.map(([address]) => address),
            tokenAddrs.map(([_, x]) => x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput)),
            limits.erc721Tokens
        ], deploylessOpts))[0];
        return collections.map((token) => [token.error, mapToken(token)]);
    }
    const { accountOps, account } = opts.simulation;
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const [before, after, simulationErr] = await deployless.call('simulateAndGetAllNFTs', [
        accountAddr,
        tokenAddrs.map(([address]) => address),
        tokenAddrs.map(([_, x]) => (x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput))),
        limits.erc721Tokens,
        factory,
        factoryCalldata,
        accountOps.map(({ nonce, calls, signature }) => [nonce, calls.map(accountOp_1.callToTuple), signature])
    ], deploylessOpts);
    const beforeNonce = before[1];
    const afterNonce = after[1];
    handleSimulationError(simulationErr, beforeNonce, afterNonce);
    // no simulation was performed if the nonce is the same
    const postSimulationAmounts = (after[1] === before[1] ? before[0] : after[0]).map(mapToken);
    return before[0].map((token, i) => [
        token.error,
        { ...mapToken(token), amountPostSimulation: postSimulationAmounts[i].amount }
    ]);
}
exports.getNFTs = getNFTs;
async function getTokens(network, deployless, opts, accountAddr, tokenAddrs) {
    const mapToken = (token, address) => ({
        amount: token.amount,
        decimals: new Number(token.decimals),
        symbol: address === '0x0000000000000000000000000000000000000000'
            ? network.nativeAssetSymbol
            : token.symbol,
        address
    });
    const deploylessOpts = { blockTag: opts.blockTag, from: DEPLOYLESS_SIMULATION_FROM };
    if (!opts.simulation) {
        const [results] = await deployless.call('getBalances', [accountAddr, tokenAddrs], deploylessOpts);
        return results.map((token, i) => [token.error, mapToken(token, tokenAddrs[i])]);
    }
    const { accountOps, account } = opts.simulation;
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const [before, after, simulationErr] = await deployless.call('simulateAndGetBalances', [
        accountAddr,
        tokenAddrs,
        factory,
        factoryCalldata,
        accountOps.map(({ nonce, calls, signature }) => [nonce, calls.map(accountOp_1.callToTuple), signature])
    ], deploylessOpts);
    const beforeNonce = before[1];
    const afterNonce = after[1];
    handleSimulationError(simulationErr, beforeNonce, afterNonce);
    // no simulation was performed if the nonce is the same
    const postSimulationAmounts = afterNonce === beforeNonce ? before[0] : after[0];
    return before[0].map((token, i) => [
        token.error,
        { ...mapToken(token, tokenAddrs[i]), amountPostSimulation: postSimulationAmounts[i].amount }
    ]);
}
exports.getTokens = getTokens;
class SimulationError extends Error {
    constructor(message, beforeNonce, afterNonce) {
        super(`simulation error: ${message}`);
        this.simulationErrorMsg = message;
        this.beforeNonce = beforeNonce;
        this.afterNonce = afterNonce;
    }
}
//# sourceMappingURL=getOnchainBalances.js.map