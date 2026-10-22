"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MIN_GAS_PRICE = void 0;
exports.getGasPriceRecommendations = getGasPriceRecommendations;
exports.getProbableCallData = getProbableCallData;
exports.getBroadcastGas = getBroadcastGas;
exports.gasPriceToBundlerFormat = gasPriceToBundlerFormat;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const provider_1 = require("../../services/provider");
const accountOp_1 = require("../accountOp/accountOp");
const userOperation_1 = require("../userOperation/userOperation");
// a 1 gwei min for gas price, non1559 networks
exports.MIN_GAS_PRICE = 1000000000n;
// https://eips.ethereum.org/EIPS/eip-1559
// the base fee can grow by at most 1/8 (12.5%) from one block to the next
const BASE_FEE_MAX_CHANGE_DENOMINATOR = 8n;
// Per speed settings:
// * fullBlocksToTolerate - how many consecutive full blocks (each raising the
//   base fee by the max 12.5%) the txn survives before its maxFeePerGas falls
//   below the base fee and the txn gets stuck. It costs the user nothing as
//   EIP-1559 txns pay only the actual base fee + tip, maxFeePerGas is a cap
// * legacyGasPriceAddBps - buffer for non-1559 networks. Unlike the base fee
//   headroom, the legacy gasPrice is paid in full, so it's kept small
const speeds = [
    {
        name: 'slow',
        fullBlocksToTolerate: 2,
        legacyGasPriceAddBps: 0n
    },
    {
        name: 'medium',
        fullBlocksToTolerate: 3,
        legacyGasPriceAddBps: 100n
    },
    {
        name: 'fast',
        fullBlocksToTolerate: 3,
        legacyGasPriceAddBps: 200n
    },
    {
        name: 'ape',
        fullBlocksToTolerate: 4,
        legacyGasPriceAddBps: 500n
    }
];
// each speed's tip is at least 25% higher than the previous speed's one,
// so the speeds stay distinct even when the recent tips are all the same
const MIN_PRIORITY_FEE_STEP_BPS = 2500n;
const FEE_HISTORY_BLOCK_COUNT = 3;
const FEE_HISTORY_REWARD_PERCENTILES = [25, 50, 72, 88];
function median(data) {
    if (data.length === 0)
        return 0n;
    const sorted = [...data].sort((a, b) => {
        if (a === b)
            return 0;
        return a > b ? 1 : -1;
    });
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2)
        return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2n;
}
function increaseByBps(value, bps) {
    return value + (value * bps) / 10000n;
}
/**
 * Returns the base fee after `fullBlocks` consecutive full blocks,
 * each raising it by the EIP-1559 max of 12.5%
 */
function getBaseFeeAfterFullBlocks(baseFee, fullBlocks) {
    let increasedBaseFee = baseFee;
    for (let i = 0; i < fullBlocks; i++) {
        increasedBaseFee += increasedBaseFee / BASE_FEE_MAX_CHANGE_DENOMINATOR;
    }
    return increasedBaseFee;
}
function getMedianPriorityFeesFromHistory(rewards) {
    return FEE_HISTORY_REWARD_PERCENTILES.map((_percentile, percentileIndex) => {
        const fees = rewards
            .map((reward) => reward[percentileIndex])
            .filter((fee) => typeof fee === 'bigint' && fee > 0n);
        return median(fees);
    });
}
function getLastBaseFeeFromHistory(baseFeePerGas) {
    return baseFeePerGas[baseFeePerGas.length - 1] ?? null;
}
async function fetchViemFeeHistory(client) {
    return client.getFeeHistory({
        blockCount: FEE_HISTORY_BLOCK_COUNT,
        rewardPercentiles: FEE_HISTORY_REWARD_PERCENTILES
    });
}
async function get1559ViemFees(client) {
    return client.estimateFeesPerGas({ chain: null, type: 'eip1559' });
}
async function getLegacyViemFees(client) {
    return client.estimateFeesPerGas({ chain: null, type: 'legacy' });
}
async function get1559GasPriceRecommendations(client) {
    const [estimatedFees, feeHistory] = await Promise.all([
        get1559ViemFees(client),
        fetchViemFeeHistory(client).catch((e) => {
            console.error('eth_feeHistory failed; falling back to viem fee estimation', e);
            return null;
        })
    ]);
    const estimatedBaseFee = estimatedFees.maxFeePerGas - estimatedFees.maxPriorityFeePerGas;
    const expectedBaseFee = feeHistory
        ? (getLastBaseFeeFromHistory(feeHistory.baseFeePerGas) ?? estimatedBaseFee)
        : estimatedBaseFee;
    const priorityFees = feeHistory ? getMedianPriorityFeesFromHistory(feeHistory.reward ?? []) : [];
    const estimatedPriorityFee = estimatedFees.maxPriorityFeePerGas >= 100000n ? estimatedFees.maxPriorityFeePerGas : 100000n;
    const slowPriorityFee = priorityFees[0] && priorityFees[0] > estimatedPriorityFee
        ? priorityFees[0]
        : estimatedPriorityFee;
    const fee = [];
    speeds.forEach(({ name, fullBlocksToTolerate }, i) => {
        const baseFeePerGas = getBaseFeeAfterFullBlocks(expectedBaseFee, fullBlocksToTolerate);
        const previousSpeed = fee[i - 1];
        const minPriorityFee = previousSpeed
            ? increaseByBps(previousSpeed.maxPriorityFeePerGas, MIN_PRIORITY_FEE_STEP_BPS)
            : slowPriorityFee;
        // no upper limit: the median of the recent blocks ignores a single
        // expensive block, while a lasting spike is followed so the txn gets in
        const percentilePriorityFee = priorityFees[i] ?? 0n;
        const maxPriorityFeePerGas = percentilePriorityFee > minPriorityFee ? percentilePriorityFee : minPriorityFee;
        fee.push({
            name,
            baseFeePerGas,
            maxPriorityFeePerGas
        });
    });
    return fee;
}
async function getLegacyGasPriceRecommendations(client) {
    const { gasPrice } = await getLegacyViemFees(client);
    const minGasPrice = gasPrice > exports.MIN_GAS_PRICE ? gasPrice : exports.MIN_GAS_PRICE;
    return speeds.map(({ name, legacyGasPriceAddBps }) => ({
        name,
        gasPrice: increaseByBps(minGasPrice, legacyGasPriceAddBps)
    }));
}
async function getGasPriceRecommendations(provider, network, _blockTag, getIsActive) {
    if (getIsActive && !getIsActive()) {
        throw new Error('operation aborted');
    }
    const client = (0, provider_1.getViemClientForProvider)(provider);
    if (network.feeOptions.is1559) {
        return { gasPrice: await get1559GasPriceRecommendations(client) };
    }
    return { gasPrice: await getLegacyGasPriceRecommendations(client) };
}
function getProbableCallData(accountOp, accountState, shouldIncludeActivatorCall) {
    let estimationCallData;
    // include the activator call for estimation if any
    const localOp = { ...accountOp };
    if (shouldIncludeActivatorCall)
        localOp.activatorCall = (0, userOperation_1.getActivatorCall)(localOp.accountAddr);
    // always call executeMultiple as the worts case scenario
    // we disregard the initCode
    if (accountState.isDeployed) {
        const ambireAccount = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
        estimationCallData = ambireAccount.encodeFunctionData('executeMultiple', [
            [
                [
                    (0, accountOp_1.getSignableCalls)(localOp),
                    '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
                ]
            ]
        ]);
    }
    else {
        // deployAndExecuteMultiple is the worst case
        const ambireFactory = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
        estimationCallData = ambireFactory.encodeFunctionData('deployAndExecuteMultiple', [
            '0x7f00000000000000000000000000000000000000000000000000000000000000017fad3228b676f7d3cd4284a5443f17f1962b36e491b30a40b2405849e597ba5fb5553d602d80604d3d3981f3363d3d373d3d3d363d7353a31973ebcc225e219bb0d7c0c9324773f5b3e95af43d82803e903d91602b57fd5bf3',
            '0x0000000000000000000000000000000000000000000000000000000000000000',
            [
                [
                    (0, accountOp_1.getSignableCalls)(localOp),
                    '0x0dc2d37f7b285a2243b2e1e6ba7195c578c72b395c0f76556f8961b0bca97ddc44e2d7a249598f56081a375837d2b82414c3c94940db3c1e64110108021161ca1c01'
                ]
            ]
        ]);
    }
    return estimationCallData;
}
function getBroadcastGas(baseAcc, op) {
    const calldata = baseAcc.getBroadcastCalldata(op);
    if (calldata === '0x')
        return 0n;
    const FIXED_OVERHEAD = 21000n;
    const bytes = Buffer.from(baseAcc.getBroadcastCalldata(op).substring(2));
    const nonZeroBytes = BigInt(bytes.filter((b) => b).length);
    const zeroBytes = BigInt(BigInt(bytes.length) - nonZeroBytes);
    const txDataGas = zeroBytes * 4n + nonZeroBytes * 16n;
    return txDataGas + FIXED_OVERHEAD;
}
/**
 * As the name suggests, take our libs gas price format and transform it to match
 * the one returned from the bundler
 *
 * @param gasRecommendations - our lib's format
 * @returns GasSpeeds - the bundler format
 */
function gasPriceToBundlerFormat(gasRecommendations) {
    const formatted = {};
    for (let i = 0; i < gasRecommendations.length; i++) {
        const entry = gasRecommendations[i];
        if ('baseFeePerGas' in entry) {
            const eip1559 = entry;
            formatted[eip1559.name] = {
                maxFeePerGas: (0, ethers_1.toBeHex)(eip1559.baseFeePerGas + eip1559.maxPriorityFeePerGas),
                maxPriorityFeePerGas: (0, ethers_1.toBeHex)(eip1559.maxPriorityFeePerGas)
            };
        }
        else {
            const oldFormat = entry;
            formatted[oldFormat.name] = {
                maxFeePerGas: (0, ethers_1.toBeHex)(oldFormat.gasPrice),
                maxPriorityFeePerGas: 0
            };
        }
    }
    return formatted;
}
//# sourceMappingURL=gasPrice.js.map