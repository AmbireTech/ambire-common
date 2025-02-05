"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokens = exports.getNFTs = exports.getDeploylessOpts = void 0;
const deploy_1 = require("../../consts/deploy");
const deployless_1 = require("../../consts/deployless");
const simulationStateOverride_1 = require("../../utils/simulationStateOverride");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_2 = require("../deployless/deployless");
const helpers_1 = require("./helpers");
class SimulationError extends Error {
    simulationErrorMsg;
    beforeNonce;
    afterNonce;
    constructor(message, beforeNonce, afterNonce) {
        super(`simulation error: ${message}`);
        this.simulationErrorMsg = message;
        this.beforeNonce = beforeNonce;
        this.afterNonce = afterNonce;
    }
}
function handleSimulationError(error, beforeNonce, afterNonce, simulationOps) {
    if (error !== '0x')
        throw new SimulationError((0, deployless_2.parseErr)(error) || error, beforeNonce, afterNonce);
    // If the afterNonce is 0, it means that we reverted, even if the error is empty
    // In both BalanceOracle and NFTOracle, afterSimulation and therefore afterNonce will be left empty
    if (afterNonce === 0n)
        throw new SimulationError('Simulation reverted', beforeNonce, afterNonce);
    if (afterNonce < beforeNonce)
        throw new SimulationError('lower "after" nonce, should not be possible', beforeNonce, afterNonce);
    if (simulationOps.length && afterNonce === beforeNonce)
        throw new SimulationError('Account op passed for simulation but the nonce did not increment. Perhaps wrong nonce set in Account op', beforeNonce, afterNonce);
    // make sure the afterNonce (after all the accOps execution) is
    // at least the same as the final nonce in the simulationOps
    const nonces = simulationOps
        .map((op) => op.nonce ?? -1n)
        .filter((nonce) => nonce !== -1n)
        .sort((a, b) => {
        if (a === b)
            return 0;
        if (a > b)
            return 1;
        return -1;
    });
    if (nonces.length && afterNonce < nonces[nonces.length - 1] + 1n) {
        throw new SimulationError('Failed to increment the nonce to the final account op nonce', beforeNonce, afterNonce);
    }
}
function getDeploylessOpts(accountAddr, supportsStateOverride, opts) {
    return {
        blockTag: opts.blockTag,
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        mode: supportsStateOverride && opts.isEOA ? deployless_2.DeploylessMode.StateOverride : deployless_2.DeploylessMode.Detect,
        stateToOverride: supportsStateOverride && opts.isEOA ? (0, simulationStateOverride_1.getEoaSimulationStateOverride)(accountAddr) : null
    };
}
exports.getDeploylessOpts = getDeploylessOpts;
async function getNFTs(network, deployless, opts, accountAddr, tokenAddrs, limits) {
    const deploylessOpts = getDeploylessOpts(accountAddr, !network.rpcNoStateOverride, opts);
    const mapToken = (token) => {
        return {
            name: token.name,
            networkId: network.id,
            symbol: token.symbol,
            amount: BigInt(token.nfts.length),
            decimals: 1,
            collectibles: [...token.nfts]
        };
    };
    if (!opts.simulation) {
        const collections = (await deployless.call('getAllNFTs', [
            accountAddr,
            tokenAddrs.map(([address]) => address),
            tokenAddrs.map(([, x]) => x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput)),
            limits.erc721Tokens
        ], deploylessOpts))[0];
        return [collections.map((token) => [token.error, mapToken(token)]), {}];
    }
    const { accountOps, account } = opts.simulation;
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
        // EOA starts from a fake, specified nonce
        nonce: (0, account_1.isSmartAccount)(account) ? nonce : BigInt(deployless_1.EOA_SIMULATION_NONCE) + BigInt(idx),
        calls: calls.map(accountOp_1.toSingletonCall).map(accountOp_1.callToTuple)
    }));
    const [before, after, simulationErr, , , deltaAddressesMapping] = await deployless.call('simulateAndGetAllNFTs', [
        accountAddr,
        account.associatedKeys,
        tokenAddrs.map(([address]) => address),
        tokenAddrs.map(([, x]) => (x.enumerable ? [] : x.tokens.slice(0, limits.erc721TokensInput))),
        limits.erc721Tokens,
        factory,
        factoryCalldata,
        simulationOps.map((op) => Object.values(op))
    ], deploylessOpts);
    const beforeNonce = before[1];
    const afterNonce = after[1];
    handleSimulationError(simulationErr, beforeNonce, afterNonce, simulationOps);
    // simulation was performed if the nonce is changed
    const hasSimulation = afterNonce !== beforeNonce;
    const simulationTokens = hasSimulation
        ? after[0].map((simulationToken, tokenIndex) => ({
            ...mapToken(simulationToken),
            addr: deltaAddressesMapping[tokenIndex]
        }))
        : null;
    return [
        before[0].map((beforeToken, i) => {
            const simulationToken = simulationTokens
                ? simulationTokens.find((token) => token.addr.toLowerCase() === tokenAddrs[i][0].toLowerCase())
                : null;
            const token = mapToken(beforeToken);
            const receiving = [];
            const sending = [];
            token.collectibles.forEach((oldCollectible) => {
                // the first check is required because if there are no changes we will always have !undefined from the second check
                if (simulationToken?.collectibles &&
                    !simulationToken?.collectibles?.includes(oldCollectible))
                    sending.push(oldCollectible);
            });
            simulationToken?.collectibles?.forEach((newCollectible) => {
                if (!token.collectibles.includes(newCollectible))
                    receiving.push(newCollectible);
            });
            return [
                beforeToken.error,
                {
                    ...token,
                    // Please refer to getTokens() for more info regarding `amountBeforeSimulation` calc
                    simulationAmount: simulationToken ? simulationToken.amount - token.amount : undefined,
                    amountPostSimulation: simulationToken ? simulationToken.amount : token.amount,
                    postSimulation: { receiving, sending }
                }
            ];
        }),
        {}
    ];
}
exports.getNFTs = getNFTs;
async function getTokens(network, deployless, opts, accountAddr, tokenAddrs) {
    const mapToken = (token, address) => {
        return {
            amount: token.amount,
            networkId: network.id,
            decimals: Number(token.decimals),
            symbol: address === '0x0000000000000000000000000000000000000000'
                ? network.nativeAssetSymbol
                : (0, helpers_1.overrideSymbol)(address, network.id, token.symbol),
            address,
            flags: (0, helpers_1.getFlags)({}, network.id, network.id, address)
        };
    };
    const deploylessOpts = getDeploylessOpts(accountAddr, !network.rpcNoStateOverride, opts);
    if (!opts.simulation) {
        const [results, blockNumber] = await deployless.call('getBalances', [accountAddr, tokenAddrs], deploylessOpts);
        return [
            results.map((token, i) => [token.error, mapToken(token, tokenAddrs[i])]),
            {
                blockNumber
            }
        ];
    }
    const { accountOps, account } = opts.simulation;
    const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
        // EOA starts from a fake, specified nonce
        nonce: (0, account_1.isSmartAccount)(account) ? nonce : BigInt(deployless_1.EOA_SIMULATION_NONCE) + BigInt(idx),
        calls: calls.map(accountOp_1.toSingletonCall).map(accountOp_1.callToTuple)
    }));
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const [before, after, simulationErr, , blockNumber, deltaAddressesMapping] = await deployless.call('simulateAndGetBalances', [
        accountAddr,
        account.associatedKeys,
        tokenAddrs,
        factory,
        factoryCalldata,
        simulationOps.map((op) => Object.values(op))
    ], deploylessOpts);
    const beforeNonce = before[1];
    const afterNonce = after[1];
    handleSimulationError(simulationErr, beforeNonce, afterNonce, simulationOps);
    // simulation was performed if the nonce is changed
    const hasSimulation = afterNonce !== beforeNonce;
    const simulationTokens = hasSimulation
        ? after[0].map((simulationToken, tokenIndex) => ({
            ...simulationToken,
            amount: simulationToken.amount,
            addr: deltaAddressesMapping[tokenIndex]
        }))
        : null;
    return [
        before[0].map((token, i) => {
            const simulation = simulationTokens
                ? simulationTokens.find((simulationToken) => simulationToken.addr === tokenAddrs[i])
                : null;
            // Here's the math before `simulationAmount` and `amountPostSimulation`.
            // AccountA initial balance: 10 USDC.
            // AccountA attempts to transfer 5 USDC (not signed yet).
            // An external entity sends 3 USDC to AccountA on-chain.
            // Deployless simulation contract processing:
            //   - Balance before simulation (before[0]): 10 USDC + 3 USDC = 13 USDC.
            //   - Balance after simulation (after[0]): 10 USDC - 5 USDC + 3 USDC = 8 USDC.
            // Simulation-only balance displayed on the Sign Screen (we will call it `simulationAmount`):
            //   - difference between after simulation and before: 8 USDC - 13 USDC = -5 USDC
            // Final balance displayed on the Dashboard (we will call it `amountPostSimulation`):
            //   - after[0], 8 USDC.
            return [
                token.error,
                {
                    ...mapToken(token, tokenAddrs[i]),
                    simulationAmount: simulation ? simulation.amount - token.amount : undefined,
                    amountPostSimulation: simulation ? simulation.amount : token.amount
                }
            ];
        }),
        {
            blockNumber,
            beforeNonce,
            afterNonce
        }
    ];
}
exports.getTokens = getTokens;
//# sourceMappingURL=getOnchainBalances.js.map