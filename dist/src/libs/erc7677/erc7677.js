"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPaymasterData = exports.getPaymasterStubData = exports.getPaymasterService = void 0;
const ethers_1 = require("ethers");
const deploy_1 = require("../../consts/deploy");
const provider_1 = require("../../services/provider");
const userOperation_1 = require("../userOperation/userOperation");
function getPaymasterService(chainId, capabilities) {
    if (!capabilities || !capabilities.paymasterService)
        return undefined;
    // hex may come with a leading zero or not. Prepare for both
    const chainIdHex = (0, ethers_1.toBeHex)(chainId);
    const chainIdQuantity = (0, ethers_1.toQuantity)(chainId);
    const paymasterService = chainIdHex in capabilities.paymasterService
        ? capabilities.paymasterService[chainIdHex]
        : capabilities.paymasterService[chainIdQuantity];
    if (!paymasterService)
        return undefined;
    paymasterService.id = new Date().getTime();
    return paymasterService;
}
exports.getPaymasterService = getPaymasterService;
function getPaymasterStubData(service, userOp, network) {
    const provider = (0, provider_1.getRpcProvider)([service.url], network.chainId);
    return provider.send('pm_getPaymasterStubData', [
        (0, userOperation_1.getCleanUserOp)(userOp)[0],
        deploy_1.ERC_4337_ENTRYPOINT,
        (0, ethers_1.toBeHex)(network.chainId.toString()),
        service.context
    ]);
}
exports.getPaymasterStubData = getPaymasterStubData;
async function getPaymasterData(service, userOp, network) {
    const provider = (0, provider_1.getRpcProvider)([service.url], network.chainId);
    return provider.send('pm_getPaymasterData', [
        (0, userOperation_1.getCleanUserOp)(userOp)[0],
        deploy_1.ERC_4337_ENTRYPOINT,
        (0, ethers_1.toBeHex)(network.chainId.toString()),
        service.context
    ]);
}
exports.getPaymasterData = getPaymasterData;
//# sourceMappingURL=erc7677.js.map