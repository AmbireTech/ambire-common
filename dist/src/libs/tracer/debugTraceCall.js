"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCallTracerResult = parseCallTracerResult;
exports.getStateOverride = getStateOverride;
exports.getFunctionParams = getFunctionParams;
exports.getDiscoveredAssets = getDiscoveredAssets;
exports.debugTraceCall = debugTraceCall;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const deploy_1 = require("../proxyDeploy/deploy");
const simulationStateOverride_1 = require("../../utils/simulationStateOverride");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireAccount7702_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount7702.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const BalanceGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/BalanceGetter.json"));
const NFTGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/NFTGetter.json"));
const deploy_2 = require("../../consts/deploy");
const deployless_1 = require("../../consts/deployless");
const provider_1 = require("../../services/provider");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_2 = require("../deployless/deployless");
const getOnchainBalances_1 = require("../portfolio/getOnchainBalances");
const NFT_COLLECTION_LIMIT = 100;
const ERC721_TRANSFER_TOPIC = (0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)('Transfer(address,address,uint256)'));
function parseCallTracerResult(result) {
    const tokenAddresses = new Set();
    const nftTokenIdsByAddress = new Map();
    const addTokenAddress = (address) => {
        if (!address)
            return;
        tokenAddresses.add((0, ethers_1.getAddress)(address));
    };
    const addNftTransfer = (log) => {
        if (log.topics?.length !== 4 ||
            log.topics[0]?.toLowerCase() !== ERC721_TRANSFER_TOPIC.toLowerCase())
            return;
        const address = (0, ethers_1.getAddress)(log.address);
        const tokenId = BigInt(log.topics[3]);
        const tokenIds = nftTokenIdsByAddress.get(address) || new Set();
        tokenIds.add(tokenId);
        nftTokenIdsByAddress.set(address, tokenIds);
    };
    const collectFrameAssets = (frame) => {
        if (!frame)
            return;
        addTokenAddress(frame.to);
        frame.logs?.forEach((log) => {
            addTokenAddress(log.address);
            addNftTransfer(log);
        });
        frame.calls?.forEach(collectFrameAssets);
    };
    collectFrameAssets(result);
    return {
        tokens: Array.from(tokenAddresses),
        nfts: Array.from(nftTokenIdsByAddress.entries()).map(([address, tokenIds]) => [
            address,
            Array.from(tokenIds)
        ])
    };
}
function getStateOverride(account, op, accountState) {
    // if the account is a Safe,
    // add an additional state override that gives privileges to the assKey;
    // also, we changed privs storage slot to ambire.smart.contracts.storage
    // so privs no longer override slot number 0
    const stateDiff = !!account.safeCreation
        ? {
            [(0, deploy_1.privSlot)((0, ethers_1.keccak256)((0, ethers_1.toUtf8Bytes)('ambire.smart.contracts.storage')), 'uint256', account.associatedKeys[0], 'bytes32')]: '0x0000000000000000000000000000000000000000000000000000000000000002'
        }
        : undefined;
    // add stateOverride when using a Safe as well
    const stateOverride = !!account.safeCreation || (op.calls.length > 1 && (0, account_1.isBasicAccount)(account, accountState))
        ? {
            [account.addr]: {
                code: AmbireAccount7702_json_1.default.binRuntime,
                stateDiff
            }
        }
        : undefined;
    return stateOverride;
}
// if using EOA, use the first and only call of the account op
// if it's SA, make the data execute or deployAndExecute,
// set the spoof+addr and pass all the calls
function getFunctionParams(account, op, accountState) {
    if ((0, account_1.isBasicAccount)(account, accountState) && op.calls.length === 1) {
        const call = op.calls[0];
        return {
            to: call.to,
            value: (0, ethers_1.toQuantity)(call.value.toString()),
            data: call.data,
            from: op.accountAddr
        };
    }
    if ((0, account_1.isBasicAccount)(account, accountState)) {
        const saAbi = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
        const callData = saAbi.encodeFunctionData('execute', [(0, accountOp_1.getSignableCalls)(op), (0, account_1.getSpoof)(account)]);
        return {
            to: account.addr,
            value: 0,
            data: callData,
            from: deploy_2.DEPLOYLESS_SIMULATION_FROM
        };
    }
    if (!!account.safeCreation && !accountState.isDeployed)
        return null;
    const saAbi = new ethers_1.Interface(AmbireAccount_json_1.default.abi);
    const factoryAbi = new ethers_1.Interface(AmbireFactory_json_1.default.abi);
    const callData = accountState.isDeployed
        ? saAbi.encodeFunctionData('execute', [(0, accountOp_1.getSignableCalls)(op), (0, account_1.getSpoof)(account)])
        : factoryAbi.encodeFunctionData('deployAndExecute', [
            account.creation.bytecode,
            account.creation.salt,
            (0, accountOp_1.getSignableCalls)(op),
            (0, account_1.getSpoof)(account)
        ]);
    return {
        from: deploy_2.DEPLOYLESS_SIMULATION_FROM,
        to: accountState.isDeployed ? account.addr : account.creation.factoryAddr,
        value: 0,
        data: callData
    };
}
async function getDiscoveredAssets(provider, baseAcc, op, network, accountState, foundTokens, foundNftTransfers) {
    const account = baseAcc.getAccount();
    const opts = {
        blockTag: 'latest',
        from: deploy_2.DEPLOYLESS_SIMULATION_FROM,
        mode: deployless_2.DeploylessMode.ProxyContract,
        isEOA: (0, account_1.isBasicAccount)(account, accountState),
        simulation: {
            accountOps: [op],
            baseAccount: baseAcc,
            state: accountState
        }
    };
    const deploylessOpts = (0, getOnchainBalances_1.getDeploylessOpts)(account.addr, network, opts);
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const simulationOps = [
        [
            !(0, account_1.isBasicAccount)(account, accountState) ? op.nonce : BigInt(deployless_1.EOA_SIMULATION_NONCE),
            op.calls.map(accountOp_1.callToTuple)
        ]
    ];
    // we set the 3rd param to "true" as we don't need state override
    const deploylessTokens = (0, deployless_2.fromDescriptor)(provider, BalanceGetter_json_1.default, true);
    const deploylessNfts = (0, deployless_2.fromDescriptor)(provider, NFTGetter_json_1.default, true);
    const getNftsPromise = deploylessNfts.call('simulateAndGetAllNFTs', [
        op.accountAddr,
        account.associatedKeys,
        foundNftTransfers.map(([address]) => address),
        foundNftTransfers.map(([, x]) => x),
        NFT_COLLECTION_LIMIT,
        // Only the errors are read here, so no metadata is worth fetching
        '0x',
        factory,
        factoryCalldata,
        simulationOps
    ], deploylessOpts);
    const result = await Promise.all([
        deploylessTokens.call('getBalances', [op.accountAddr, foundTokens, '0x'], deploylessOpts),
        getNftsPromise
    ]);
    const [[tokensWithErr], [before, after, , , , , deltaAddressesMapping]] = result;
    const beforeNftCollections = before.collections;
    const afterNftCollections = after.collections;
    // NFTCollectionBalance is (nfts, error)
    const collectionError = (collection) => collection?.[1];
    return {
        tokens: foundTokens.filter((addr, i) => tokensWithErr[i].error === '0x'),
        nfts: foundNftTransfers.filter((nft, i) => {
            const beforeError = collectionError(beforeNftCollections[i]);
            if (!beforeError || beforeError === '0x')
                return true;
            // The delta array and its addresses mapping are parallel, so the collection
            // after the simulation sits at the same index as its address
            const afterIndex = deltaAddressesMapping.findIndex((addr) => addr.toLowerCase() === foundNftTransfers[i][0].toLowerCase());
            if (afterIndex === -1)
                return false;
            const afterError = collectionError(afterNftCollections[afterIndex]);
            return !afterError || afterError === '0x';
        })
    };
}
async function debugTraceCall(baseAcc, op, network, accountState, overrideData) {
    const account = baseAcc.getAccount();
    const opts = {
        blockTag: 'latest',
        from: deploy_2.DEPLOYLESS_SIMULATION_FROM,
        mode: deployless_2.DeploylessMode.ProxyContract,
        isEOA: (0, account_1.isBasicAccount)(account, accountState),
        simulation: {
            accountOps: [op],
            baseAccount: baseAcc,
            state: accountState
        }
    };
    const params = getFunctionParams(account, op, accountState);
    // we throw on purpose here so the controller receives feedback that
    // debugTraceCall has actually failed
    if (!params)
        throw new Error('cannot run debug_traceCall as getFunctionParams is empty');
    // initialize a new provider for debug trace call to avoid batching it
    // as sometimes debug_traceCall gets handled really slowly from the RPCs
    // and that affects wallet performance
    const provider = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId, network.selectedRpcUrl);
    try {
        const trace = await provider.send('debug_traceCall', [
            {
                to: params.to,
                value: (0, ethers_1.toQuantity)(params.value.toString()),
                data: params.data,
                from: params.from
            },
            'latest',
            {
                // we're replacing the custom tracer with the built-in callTracer
                // because it has broader RPC support. The trade off is that the
                // data we're pulling from the RPC is a bit bigger compared to the
                // custom tracer. But at least it works broadly as networks like Base
                // that use geth only don't support custom tracers, resulting in
                // bad discovery
                tracer: 'callTracer',
                tracerConfig: {
                    withLog: true
                },
                stateOverrides: (0, simulationStateOverride_1.getShouldStateOverride)(network, opts.simulation.baseAccount)
                    ? {
                        [params.from]: {
                            balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                        },
                        ...overrideData
                    }
                    : {}
            }
        ]);
        const { tokens: foundTokens, nfts: foundNftTransfers } = parseCallTracerResult(trace);
        return await getDiscoveredAssets(provider, baseAcc, op, network, accountState, foundTokens, foundNftTransfers);
    }
    catch (e) {
        // we do this so we could run finally
        throw e;
    }
    finally {
        // clean up the provider after usage
        try {
            provider.destroy();
        }
        catch (e) {
            console.error(e);
        }
    }
}
//# sourceMappingURL=debugTraceCall.js.map