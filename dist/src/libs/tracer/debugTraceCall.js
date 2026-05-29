"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getStateOverride = getStateOverride;
exports.getFunctionParams = getFunctionParams;
exports.debugTraceCall = debugTraceCall;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const deploy_1 = require("@/libs/proxyDeploy/deploy");
const simulationStateOverride_1 = require("@/utils/simulationStateOverride");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireAccount7702_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount7702.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const BalanceGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/BalanceGetter.json"));
const NFTGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/NFTGetter.json"));
const ProviderError_1 = require("../../classes/ProviderError");
const deploy_2 = require("../../consts/deploy");
const deployless_1 = require("../../consts/deployless");
const provider_1 = require("../../services/provider");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_2 = require("../deployless/deployless");
const getOnchainBalances_1 = require("../portfolio/getOnchainBalances");
const NFT_COLLECTION_LIMIT = 100;
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
    const deploylessOpts = (0, getOnchainBalances_1.getDeploylessOpts)(account.addr, network, opts);
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const simulationOps = [
        [
            !(0, account_1.isBasicAccount)(account, accountState) ? op.nonce : BigInt(deployless_1.EOA_SIMULATION_NONCE),
            op.calls.map(accountOp_1.callToTuple)
        ]
    ];
    // initialize a new provider for debug trace call to avoid batching it
    // as sometimes debug_traceCall gets handled really slowly from the RPCs
    // and that affects wallet performance
    const provider = (0, provider_1.getRpcProvider)(network.rpcUrls, network.chainId, network.selectedRpcUrl);
    const params = getFunctionParams(account, op, accountState);
    if (!params)
        return { tokens: [], nfts: [] };
    const results = await provider
        .send('debug_traceCall', [
        {
            to: params.to,
            value: (0, ethers_1.toQuantity)(params.value.toString()),
            data: params.data,
            from: params.from
        },
        'latest',
        {
            tracer: `{
          discovered: [],
          fault: function (log) {},
          step: function (log) {
            const found = this.discovered.map(ob => ob.address)
            if (log.contract && log.contract.getAddress() && found.indexOf(toHex(log.contract.getAddress())) === -1) {
              this.discovered.push({
                erc: 20,
                address: toHex(log.contract.getAddress())
              })
            }
            if (log.op.toString() === 'LOG4') {
              this.discovered.push({
                erc: 721,
                address: toHex(log.contract.getAddress()),
                tokenId: '0x' + log.stack.peek(5).toString(16)
              })
            }
          },
          result: function () {
            return this.discovered
          }
        }`,
            enableMemory: false,
            enableReturnData: true,
            disableStorage: true,
            stateOverrides: (0, simulationStateOverride_1.getShouldStateOverride)(network, opts.simulation.baseAccount)
                ? {
                    // TODO: if it's an EOA, add the EOA state override data
                    [params.from]: {
                        balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                    },
                    ...overrideData
                }
                : {}
        }
    ])
        .catch((e) => {
        throw new ProviderError_1.ProviderError({ originalError: e, providerUrl: provider._getConnection()?.url });
    });
    const foundTokens = [
        ...new Set(results.filter((i) => i?.erc === 20).map((i) => (0, ethers_1.getAddress)(i.address)))
    ];
    const foundNftTransfersObject = results
        .filter((i) => i?.erc === 721)
        .reduce((res, i) => {
        if (!res[i?.address])
            res[i?.address] = new Set();
        res[i.address].add(i.tokenId);
        return res;
    }, {});
    const foundNftTransfers = Object.entries(foundNftTransfersObject).map(([address, id]) => [(0, ethers_1.getAddress)(address), Array.from(id).map((i) => BigInt(i))]);
    // we set the 3rd param to "true" as we don't need state override
    const deploylessTokens = (0, deployless_2.fromDescriptor)(provider, BalanceGetter_json_1.default, true);
    const deploylessNfts = (0, deployless_2.fromDescriptor)(provider, NFTGetter_json_1.default, true);
    const getNftsPromise = deploylessNfts.call('simulateAndGetAllNFTs', [
        op.accountAddr,
        account.associatedKeys,
        foundNftTransfers.map(([address]) => address),
        foundNftTransfers.map(([, x]) => x),
        NFT_COLLECTION_LIMIT,
        factory,
        factoryCalldata,
        simulationOps
    ], deploylessOpts);
    const result = await Promise.all([
        deploylessTokens.call('getBalances', [op.accountAddr, foundTokens], deploylessOpts),
        getNftsPromise
    ]);
    const [[tokensWithErr], [before, after, , , , deltaAddressesMapping]] = result;
    const beforeNftCollections = before.collections;
    const afterNftCollections = after.collections;
    // clean up the provider after usage
    try {
        provider.destroy();
    }
    catch (e) {
        console.error(e);
    }
    return {
        tokens: foundTokens.filter((addr, i) => tokensWithErr[i].error === '0x'),
        nfts: foundNftTransfers.filter((nft, i) => {
            if (!beforeNftCollections[i][3] || beforeNftCollections[i][3] === '0x')
                return true;
            const foundAfterToken = afterNftCollections.find((t, j) => deltaAddressesMapping[j].toLowerCase() === foundNftTransfers[i][0].toLowerCase());
            if (!foundAfterToken || !foundAfterToken[0])
                return false;
            return !foundAfterToken[i][3] || foundAfterToken[0][3] === '0x';
        })
    };
}
//# sourceMappingURL=debugTraceCall.js.map