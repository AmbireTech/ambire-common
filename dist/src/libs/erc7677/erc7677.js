import { toBeHex, toQuantity } from 'ethers';
import { ERC_4337_ENTRYPOINT } from '../../consts/deploy';
import { getRpcProvider } from '../../services/provider';
import { getCleanUserOp } from '../userOperation/userOperation';
export function getPaymasterService(chainId, capabilities) {
    if (!capabilities || !capabilities.paymasterService)
        return undefined;
    // hex may come with a leading zero or not. Prepare for both
    const chainIdHex = toBeHex(chainId);
    const chainIdQuantity = toQuantity(chainId);
    const paymasterService = chainIdHex in capabilities.paymasterService
        ? capabilities.paymasterService[chainIdHex]
        : capabilities.paymasterService[chainIdQuantity];
    if (!paymasterService)
        return undefined;
    paymasterService.id = new Date().getTime();
    return paymasterService;
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
    return provider.send('pm_getPaymasterData', [
        getCleanUserOp(userOp)[0],
        ERC_4337_ENTRYPOINT,
        toBeHex(network.chainId.toString()),
        service.context
    ]);
}
//# sourceMappingURL=erc7677.js.map