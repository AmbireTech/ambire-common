"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.debugTraceCall = void 0;
const tslib_1 = require("tslib");
const ethers_1 = require("ethers");
const AmbireAccount_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireAccount.json"));
const AmbireFactory_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/AmbireFactory.json"));
const BalanceGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/BalanceGetter.json"));
const NFTGetter_json_1 = tslib_1.__importDefault(require("../../../contracts/compiled/NFTGetter.json"));
const deploy_1 = require("../../consts/deploy");
const deployless_1 = require("../../consts/deployless");
const account_1 = require("../account/account");
const accountOp_1 = require("../accountOp/accountOp");
const deployless_2 = require("../deployless/deployless");
const getOnchainBalances_1 = require("../portfolio/getOnchainBalances");
const NFT_COLLECTION_LIMIT = 100;
// if using EOA, use the first and only call of the account op
// if it's SA, make the data execute or deployAndExecute,
// set the spoof+addr and pass all the calls
function getFunctionParams(account, op, accountState) {
    if (!account.creation) {
        const call = op.calls[0];
        return {
            to: call.to,
            value: (0, ethers_1.toQuantity)(call.value.toString()),
            data: call.data,
            from: op.accountAddr
        };
    }
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
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        to: accountState.isDeployed ? account.addr : account.creation.factoryAddr,
        value: 0,
        data: callData
    };
}
async function debugTraceCall(account, op, provider, accountState, gasUsed, gasPrices, supportsStateOverride, overrideData) {
    const opts = {
        blockTag: 'latest',
        from: deploy_1.DEPLOYLESS_SIMULATION_FROM,
        mode: deployless_2.DeploylessMode.ProxyContract,
        isEOA: !(0, account_1.isSmartAccount)(account)
    };
    const deploylessOpts = (0, getOnchainBalances_1.getDeploylessOpts)(account.addr, supportsStateOverride, opts);
    const [factory, factoryCalldata] = (0, account_1.getAccountDeployParams)(account);
    const simulationOps = [
        [(0, account_1.isSmartAccount)(account) ? op.nonce : BigInt(deployless_1.EOA_SIMULATION_NONCE), op.calls.map(accountOp_1.callToTuple)]
    ];
    const fast = gasPrices.find((gas) => gas.name === 'fast');
    if (!fast)
        return { tokens: [], nfts: [] };
    const gasPrice = 'gasPrice' in fast ? fast.gasPrice : fast.baseFeePerGas + fast.maxPriorityFeePerGas;
    const params = getFunctionParams(account, op, accountState);
    const results = await provider.send('debug_traceCall', [
        {
            to: params.to,
            value: (0, ethers_1.toQuantity)(params.value.toString()),
            data: params.data,
            from: params.from,
            gasPrice: (0, ethers_1.toQuantity)(gasPrice.toString()),
            gas: (0, ethers_1.toQuantity)(gasUsed.toString())
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
            stateOverrides: supportsStateOverride
                ? {
                    [params.from]: {
                        balance: '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
                    },
                    ...overrideData
                }
                : {}
        }
    ]);
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
    const [[tokensWithErr], [before, after, , , , deltaAddressesMapping]] = await Promise.all([
        deploylessTokens.call('getBalances', [op.accountAddr, foundTokens], opts),
        getNftsPromise
    ]);
    const beforeNftCollections = before[0];
    const afterNftCollections = after[0];
    return {
        tokens: foundTokens.filter((addr, i) => tokensWithErr[i].error === '0x'),
        nfts: foundNftTransfers.filter((nft, i) => {
            if (beforeNftCollections[i][3] === '0x')
                return true;
            const foundAfterToken = afterNftCollections.find((t, j) => deltaAddressesMapping[j].toLowerCase() === foundNftTransfers[i][0].toLowerCase());
            if (!foundAfterToken || !foundAfterToken[0])
                return false;
            return foundAfterToken[0][3] === '0x';
        })
    };
}
exports.debugTraceCall = debugTraceCall;
//# sourceMappingURL=debugTraceCall.js.map