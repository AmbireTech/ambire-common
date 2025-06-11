"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymasterService = getPaymasterService;
exports.getAmbirePaymasterService = getAmbirePaymasterService;
exports.getPaymasterStubData = getPaymasterStubData;
exports.getPaymasterData = getPaymasterData;
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const provider_1 = require("../../services/provider");
const userOperation_1 = require("../userOperation/userOperation");
function getPaymasterService(chainId, capabilities) {
    if (!capabilities || !capabilities.paymasterService)
        return undefined;
    // this means it's v2
    if ('url' in capabilities.paymasterService) {
        const paymasterService = capabilities.paymasterService;
        paymasterService.id = new Date().getTime();
        return paymasterService;
    }
    // hex may come with a leading zero or not. Prepare for both
    const chainIds = Object.keys(capabilities.paymasterService);
    const chainIdHex = (0, ethers_1.toBeHex)(chainId).toLowerCase();
    const chainIdQuantity = (0, ethers_1.toQuantity)(chainId).toLowerCase();
    const foundChainId = chainIds.find((id) => id.toLowerCase() === chainIdHex || id.toLowerCase() === chainIdQuantity);
    if (!foundChainId)
        return undefined;
    const paymasterService = capabilities.paymasterService[foundChainId];
    paymasterService.id = new Date().getTime();
    return paymasterService;
}
function getAmbirePaymasterService(baseAcc, relayerUrl) {
    if (!baseAcc.isSponsorable())
        return undefined;
    return {
        url: `${relayerUrl}/v2/sponsorship`,
        id: new Date().getTime()
    };
}
function getPaymasterStubData(service, userOp, network) {
    const provider = (0, provider_1.getRpcProvider)([service.url], network.chainId);
    return provider.send('pm_getPaymasterStubData', [
        (0, userOperation_1.getCleanUserOp)(userOp)[0],
        deploy_1.ERC_4337_ENTRYPOINT,
        (0, ethers_1.toBeHex)(network.chainId.toString()),
        service.context
    ]);
}
async function getPaymasterData(service, userOp, network) {
    const provider = (0, provider_1.getRpcProvider)([service.url], network.chainId);
    return provider.send('pm_getPaymasterData', [
        (0, userOperation_1.getCleanUserOp)(userOp)[0],
        deploy_1.ERC_4337_ENTRYPOINT,
        (0, ethers_1.toBeHex)(network.chainId.toString()),
        service.context
    ]);
}
//# sourceMappingURL=erc7677.js.map