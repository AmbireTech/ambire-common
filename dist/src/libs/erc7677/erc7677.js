"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMBIRE_NETWORK_WIDE_SPONSORSHIP_POLICY = exports.AMBIRE_SWAP_POLICY = void 0;
exports.getPaymasterService = getPaymasterService;
exports.getAmbireSponsorshipUrl = getAmbireSponsorshipUrl;
exports.getAmbirePaymasterService = getAmbirePaymasterService;
exports.getPaymasterStubData = getPaymasterStubData;
exports.getPaymasterData = getPaymasterData;
const ethers_1 = require("ethers");
const uuid_1 = require("../../utils/uuid");
const deploy_1 = require("../../consts/deploy");
const provider_1 = require("../../services/provider");
const userOperation_1 = require("../userOperation/userOperation");
exports.AMBIRE_SWAP_POLICY = 'ambireSwapSponsorship';
/**
 * Currently, only the Gnosis chain is sponsored unconditionally
 */
exports.AMBIRE_NETWORK_WIDE_SPONSORSHIP_POLICY = 'ambireGnosisSponsorship';
function getPaymasterService(chainId, capabilities) {
    if (!capabilities || !capabilities.paymasterService)
        return undefined;
    // this means it's v2
    if ('url' in capabilities.paymasterService) {
        const paymasterService = capabilities.paymasterService;
        paymasterService.id = (0, uuid_1.generateUuid)();
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
    paymasterService.id = (0, uuid_1.generateUuid)();
    return paymasterService;
}
function getAmbireSponsorshipUrl(relayerUrl) {
    return `${relayerUrl}/v2/sponsorship`;
}
function getAmbirePaymasterService(baseAcc, relayerUrl) {
    if (!baseAcc.isSponsorable())
        return undefined;
    return {
        url: getAmbireSponsorshipUrl(relayerUrl),
        id: (0, uuid_1.generateUuid)(),
        context: {
            policyId: exports.AMBIRE_NETWORK_WIDE_SPONSORSHIP_POLICY
        }
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
    // TODO<Bobby>: better way to send the bundler
    // send the whole userOp if the sponsorship is from ambire.com
    // so we could fetch the bundler used
    const reqUserOp = (0, userOperation_1.getCleanUserOp)(userOp)[0];
    if (service.url.indexOf('ambire.com') !== -1) {
        reqUserOp.bundler = userOp.bundler;
    }
    return provider.send('pm_getPaymasterData', [
        reqUserOp,
        deploy_1.ERC_4337_ENTRYPOINT,
        (0, ethers_1.toBeHex)(network.chainId.toString()),
        service.context
    ]);
}
//# sourceMappingURL=erc7677.js.map