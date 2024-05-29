"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTokens = exports.getNFTs = exports.EOA_SIMULATION_NONCE = void 0;
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = __importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const deploy_1 = require("../../consts/deploy");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_1 = require("../deployless/deployless");
const deploy_2 = require("../proxyDeploy/deploy");
const helpers_1 = require("./helpers");
// fake nonce for EOA simulation
exports.EOA_SIMULATION_NONCE = '0x1000000000000000000000000000000000000000000000000000000000000000';
class SimulationError extends Error {
    constructor(message, beforeNonce, afterNonce) {
        super(`simulation error: ${message}`);
        this.simulationErrorMsg = message;
        this.beforeNonce = beforeNonce;
        this.afterNonce = afterNonce;
    }
}
function handleSimulationError(error, beforeNonce, afterNonce, simulationOps) {
    if (error !== '0x')
        throw new SimulationError((0, deployless_1.parseErr)(error) || error, beforeNonce, afterNonce);
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
        .sort();
    if (nonces.length && afterNonce < nonces[nonces.length - 1] + 1n) {
        throw new SimulationError('Failed to increment the nonce to the final account op nonce', beforeNonce, afterNonce);
    }
}
function getDeploylessOpts(accountAddr, opts) {
    return {
        blockTag: opts.blockTag,
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        mode: opts.isEOA ? deployless_1.DeploylessMode.StateOverride : deployless_1.DeploylessMode.Detect,
        stateToOverride: opts.isEOA
            ? {
                [accountAddr]: {
                    code: AmbireAccount_json_1.default.binRuntime,
                    stateDiff: {
                        // if we use 0x00...01 we get a geth bug: "invalid argument 2: hex number with leading zero digits\" - on some RPC providers
                        [`0x${(0, deploy_2.privSlot)(0, 'address', accountAddr, 'bytes32')}`]: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
                        // any number with leading zeros is not supported on some RPCs
                        [(0, ethers_1.toBeHex)(1, 32)]: exports.EOA_SIMULATION_NONCE
                    }
                }
            }
            : null
    };
}
async function getNFTs(network, deployless, opts, accountAddr, tokenAddrs, limits) {
    const deploylessOpts = getDeploylessOpts(accountAddr, opts);
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
        return collections.map((token) => [token.error, mapToken(token)]);
    }
    const { accountOps, account } = opts.simulation;
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const simulationOps = accountOps.map(({ nonce, calls }) => ({
        // EOA starts from a fake, specified nonce
        nonce: (0, account_1.isSmartAccount)(account) ? nonce : BigInt(exports.EOA_SIMULATION_NONCE),
        calls: calls.map(accountOp_1.callToTuple)
    }));
    const [before, after, simulationErr] = await deployless.call('simulateAndGetAllNFTs', [
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
    // no simulation was performed if the nonce is the same
    const postSimulationAmounts = (after[1] === before[1] ? before[0] : after[0]).map(mapToken);
    return before[0].map((token, i) => [
        token.error,
        { ...mapToken(token), amountPostSimulation: postSimulationAmounts[i].amount }
    ]);
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
    const deploylessOpts = getDeploylessOpts(accountAddr, opts);
    if (!opts.simulation) {
        const [results] = await deployless.call('getBalances', [accountAddr, tokenAddrs], deploylessOpts);
        return results.map((token, i) => [token.error, mapToken(token, tokenAddrs[i])]);
    }
    const { accountOps, account } = opts.simulation;
    const simulationOps = accountOps.map(({ nonce, calls }) => ({
        // EOA starts from a fake, specified nonce
        nonce: (0, account_1.isSmartAccount)(account) ? nonce : BigInt(exports.EOA_SIMULATION_NONCE),
        calls: calls.map(accountOp_1.callToTuple)
    }));
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const [before, after, simulationErr] = await deployless.call('simulateAndGetBalances', [
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
    // no simulation was performed if the nonce is the same
    const postSimulationAmounts = afterNonce === beforeNonce ? before[0] : after[0];
    return before[0].map((token, i) => [
        token.error,
        {
            ...mapToken(token, tokenAddrs[i]),
            amountPostSimulation: postSimulationAmounts[i].amount
        }
    ]);
}
exports.getTokens = getTokens;
//# sourceMappingURL=getOnchainBalances.js.map