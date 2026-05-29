import { toBeHex, toQuantity } from 'ethers';
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy';
import { getRpcProvider } from '../../services/provider';
import { getCleanUserOp } from '../userOperation/userOperation';
export function getPaymasterService(chainId, capabilities) {
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
    const chainIdHex = toBeHex(chainId).toLowerCase();
    const chainIdQuantity = toQuantity(chainId).toLowerCase();
    const foundChainId = chainIds.find((id) => id.toLowerCase() === chainIdHex || id.toLowerCase() === chainIdQuantity);
    if (!foundChainId)
        return undefined;
    const paymasterService = capabilities.paymasterService[foundChainId];
    paymasterService.id = new Date().getTime();
    return paymasterService;
}
export function getAmbirePaymasterService(baseAcc, relayerUrl) {
    if (!baseAcc.isSponsorable())
        return undefined;
    return {
        url: `${relayerUrl}/v2/sponsorship`,
        id: new Date().getTime()
    };
}
export function getPaymasterStubData(service, userOp, network) {
    const provider = getRpcProvider([service.url], network.chainId);
    return provider.send('pm_getPaymasterStubData', [
        getCleanUserOp(userOp)[0],
        ERC_4337_ENTRYPOINT,
        toBeHex(network.chainId.toString()),
        service.context
    ]);
}
export async function getPaymasterData(service, userOp, network) {
    const provider = getRpcProvider([service.url], network.chainId);
    // TODO<Bobby>: better way to send the bundler
    // send the whole userOp if the sponsorship is from ambire.com
    // so we could fetch the bundler used
    const reqUserOp = getCleanUserOp(userOp)[0];
    if (service.url.indexOf('ambire.com') !== -1) {
        reqUserOp.bundler = userOp.bundler;
    }
    return provider.send('pm_getPaymasterData', [
        reqUserOp,
        ERC_4337_ENTRYPOINT,
        toBeHex(network.chainId.toString()),
        service.context
    ]);
}
//# sourceMappingURL=erc7677.js.map