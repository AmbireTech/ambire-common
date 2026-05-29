"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDeploylessOpts = getDeploylessOpts;
exports.getNFTs = getNFTs;
exports.getTokens = getTokens;
const deploy_1 = require("../../consts/deploy");
const deployless_1 = require("../../consts/deployless");
const getBlockTag_1 = require("../../utils/getBlockTag");
const scheduler_1 = require("../../utils/scheduler");
const simulationStateOverride_1 = require("../../utils/simulationStateOverride");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_2 = require("../deployless/deployless");
const errorDecoder_1 = require("../errorDecoder");
const errors_1 = require("../errorHumanizer/errors");
const helpers_1 = require("../errorHumanizer/helpers");
const helpers_2 = require("./helpers");
class SimulationError extends Error {
    simulationErrorMsg;
    beforeNonce;
    afterNonce;
    constructor(message, beforeNonce, afterNonce) {
        super(message);
        this.simulationErrorMsg = message;
        this.beforeNonce = beforeNonce;
        this.afterNonce = afterNonce;
        console.error('simulation error: ', {
            beforeNonce,
            afterNonce,
            message
        });
    }
}
function handleSimulationError(errorData, beforeNonce, afterNonce, simulationOps) {
    if (errorData !== '0x') {
        const error = new Error(errorData);
        error.data = errorData;
        const decodedError = (0, errorDecoder_1.decodeError)(error);
        const humanizedError = (0, helpers_1.getHumanReadableErrorMessage)(null, errors_1.DEPLOYLESS_ERRORS, 'Transaction cannot be simulated because', decodedError, error);
        const fallbackMessage = `Transaction cannot be simulated because of an unknown error. Error code: ${decodedError.reason || errorData.slice(0, 10)}`;
        throw new SimulationError(humanizedError || fallbackMessage, beforeNonce, afterNonce);
    }
    // If the afterNonce is 0, it means that we reverted, even if the error is empty
    // In both BalanceOracle and NFTOracle, afterSimulation and therefore afterNonce will be left empty
    if (afterNonce === 0n)
        throw new SimulationError('Simulation reverted', beforeNonce, afterNonce);
    if (afterNonce < beforeNonce)
        throw new SimulationError('simulation error: lower "after" nonce, should not be possible', beforeNonce, afterNonce);
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
        throw new SimulationError('simulation error: Failed to increment the nonce to the final account op nonce', beforeNonce, afterNonce);
    }
}
function getDeploylessOpts(accountAddr, network, opts) {
    const shouldStateOverride = !!opts.simulation && (0, simulationStateOverride_1.getShouldStateOverride)(network, opts.simulation.baseAccount);
    return {
        blockTag: opts.blockTag,
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        mode: shouldStateOverride ? deployless_2.DeploylessMode.StateOverride : deployless_2.DeploylessMode.Detect,
        stateToOverride: shouldStateOverride ? (0, simulationStateOverride_1.getNotAmbireStateOverride)(accountAddr, network) : null
    };
}
async function getNFTs(network, deployless, opts, accountAddr, tokenAddrs, limits) {
    const deploylessOpts = getDeploylessOpts(accountAddr, network, {
        ...opts,
        blockTag: opts.blockTag === 'pending' || opts.blockTag === 'both'
            ? (0, getBlockTag_1.getPendingBlockTagIfSupported)(network)
            : opts.blockTag
    });
    const mapNft = (token, address) => {
        return {
            name: token.name,
            chainId: network.chainId,
            address,
            symbol: token.symbol,
            amount: BigInt(token.nfts.length),
            decimals: 1,
            collectibles: [...token.nfts]
        };
    };
    if (!opts.simulation) {
        const collections = await deployless.call('getAllNFTs', [
            accountAddr,
            tokenAddrs.map(([address]) => address),
            tokenAddrs.map(([, ids]) => ids.slice(0, limits.erc721TokensInput)),
            limits.erc721Tokens
        ], deploylessOpts);
        return [
            collections.map((token, index) => [
                token.error,
                mapNft(token, tokenAddrs[index][0])
            ]),
            {}
        ];
    }
    const { accountOps, baseAccount, state } = opts.simulation;
    const account = baseAccount.getAccount();
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const shouldStateOverride = (0, simulationStateOverride_1.getShouldStateOverride)(network, baseAccount);
    const simulationOps = accountOps.map(({ nonce, calls }, idx) => ({
        // state overriden accounts start from a fake, specified nonce
        nonce: !shouldStateOverride ? nonce : BigInt(deployless_1.EOA_SIMULATION_NONCE) + BigInt(idx),
        calls: calls.map(accountOp_1.toSingletonCall).map(accountOp_1.callToTuple)
    }));
    const [before, after, simulationErr, , , deltaAddressesMapping] = await deployless.call('simulateAndGetAllNFTs', [
        accountAddr,
        shouldStateOverride ? [account.addr] : account.associatedKeys,
        tokenAddrs.map(([address]) => address),
        tokenAddrs.map(([, ids]) => ids.slice(0, limits.erc721TokensInput)),
        limits.erc721Tokens,
        factory,
        factoryCalldata,
        simulationOps.map((op) => Object.values(op))
    ], deploylessOpts);
    const beforeNonce = before.nonce;
    const afterNonce = after.nonce;
    handleSimulationError(simulationErr, beforeNonce, afterNonce, simulationOps);
    // simulation was performed if the nonce is changed
    const hasSimulation = afterNonce !== beforeNonce;
    const simulationTokens = hasSimulation
        ? after.collections.map((simulationToken, tokenIndex) => ({
            ...mapNft(simulationToken, deltaAddressesMapping[tokenIndex]),
            addr: deltaAddressesMapping[tokenIndex]
        }))
        : null;
    return [
        before.collections.map((beforeToken, i) => {
            const simulationToken = simulationTokens
                ? simulationTokens.find((token) => token.addr.toLowerCase() === tokenAddrs[i][0].toLowerCase())
                : null;
            const token = mapNft(beforeToken, tokenAddrs[i][0]);
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
async function getTokens(network, deployless, opts, accountAddr, tokenAddrs, pageIndex) {
    if (typeof pageIndex === 'number' && pageIndex > 0) {
        // Allow the main thread to process other tasks before continuing
        // as encode/decode operations (in deployless) are very CPU intensive
        await (0, scheduler_1.yieldToMain)();
    }
    const isFetchingBothBlocks = opts.blockTag === 'both';
    const deploylessOpts = getDeploylessOpts(accountAddr, network, {
        ...opts,
        blockTag: opts.blockTag === 'pending' || isFetchingBothBlocks
            ? (0, getBlockTag_1.getPendingBlockTagIfSupported)(network)
            : opts.blockTag
    });
    const getMainResults = async () => {
        const { accountOps, baseAccount } = opts.simulation || {};
        if (!baseAccount) {
            throw new Error('Base account is required for simulation');
        }
        const account = baseAccount.getAccount();
        const shouldStateOverride = (0, simulationStateOverride_1.getShouldStateOverride)(network, baseAccount);
        const simulationOps = accountOps?.map(({ nonce, calls }, idx) => ({
            // state overriden accounts start from a fake, specified nonce
            nonce: !shouldStateOverride ? nonce : BigInt(deployless_1.EOA_SIMULATION_NONCE) + BigInt(idx),
            calls: calls.map(accountOp_1.toSingletonCall).map(accountOp_1.callToTuple)
        }));
        const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
        return {
            simulationOps,
            result: await deployless.call('simulateAndGetBalances', [
                accountAddr,
                shouldStateOverride ? [account.addr] : account.associatedKeys,
                tokenAddrs,
                factory,
                factoryCalldata,
                simulationOps?.map((op) => Object.values(op))
            ], deploylessOpts)
        };
    };
    if (!opts.simulation) {
        const [results, blockNumber] = await deployless.call('getBalances', [accountAddr, tokenAddrs], deploylessOpts);
        return [
            results.map((token, i) => [
                token.error,
                (0, helpers_2.mapToken)(token, network, tokenAddrs[i], opts, undefined, token.amount)
            ]),
            {
                blockNumber
            }
        ];
    }
    const mainResults = await getMainResults();
    const [before, after, simulationErr, , blockNumber, deltaAddressesMapping] = mainResults.result;
    const beforeNonce = before.nonce;
    const afterNonce = after.nonce;
    handleSimulationError(simulationErr, beforeNonce, afterNonce, mainResults.simulationOps || []);
    // simulation was performed if the nonce is changed
    const hasSimulation = afterNonce !== beforeNonce;
    const simulationTokens = hasSimulation
        ? after.balances.map((simulationToken, tokenIndex) => ({
            ...simulationToken,
            amount: simulationToken.amount,
            addr: deltaAddressesMapping[tokenIndex]
        }))
        : null;
    return [
        before.balances.map((token, i) => {
            const simulation = simulationTokens
                ? simulationTokens.find((simulationToken) => simulationToken.addr === tokenAddrs[i])
                : null;
            const simulationAmount = simulation ? simulation.amount - token.amount : undefined;
            const amountPostSimulation = simulation ? simulation.amount : token.amount;
            // Here's the math before `simulationAmount` and `amountPostSimulation`.
            // AccountA initial balance: 10 USDC.
            // AccountA attempts to transfer 5 USDC (not signed yet).
            // An external entity sends 3 USDC to AccountA on-chain.
            // Deployless simulation contract processing:
            //   - Balance before simulation (before.balances): 10 USDC + 3 USDC = 13 USDC.
            //   - Balance after simulation (after.balances): 10 USDC - 5 USDC + 3 USDC = 8 USDC.
            // Simulation-only balance displayed on the Sign Screen (we will call it `simulationAmount`):
            //   - difference between after simulation and before: 8 USDC - 13 USDC = -5 USDC
            // Final balance displayed on the Dashboard (we will call it `amountPostSimulation`):
            //   - after.balances, 8 USDC.
            return [
                token.error,
                {
                    ...(0, helpers_2.mapToken)(token, network, tokenAddrs[i], opts, !!simulationAmount, token.amount),
                    simulationAmount,
                    amountPostSimulation
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
//# sourceMappingURL=getOnchainBalances.js.map