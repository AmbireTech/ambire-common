import { EIP_7702_AMBIRE_ACCOUNT, EIP_7702_GRID_PLUS, EIP_7702_METAMASK } from '../../consts/deploy';
export function getContractImplementation(chainId, accountKeys) {
    if (accountKeys.find((key) => key.type === 'lattice')) {
        return EIP_7702_GRID_PLUS;
    }
    return EIP_7702_AMBIRE_ACCOUNT;
}
export function has7702(net) {
    return net.has7702;
}
export function getDelegatorName(contract) {
    switch (contract.toLowerCase()) {
        case EIP_7702_AMBIRE_ACCOUNT.toLowerCase():
            return 'Ambire';
        case EIP_7702_GRID_PLUS.toLowerCase():
            return 'Ambire';
        case EIP_7702_METAMASK.toLowerCase():
            return 'Metamask';
        default:
            return '';
    }
}
//# sourceMappingURL=7702.js.map