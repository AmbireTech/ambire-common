import { Hex } from '../../interfaces/hex';
import { Network } from '../../interfaces/network';
export declare function getContractImplementation(chainId: bigint, accountKeys: {
    type: 'internal' | 'lattice' | 'trezor' | 'ledger' | 'qr';
}[]): Hex;
export declare function has7702(net: Network): boolean;
export declare function getDelegatorName(contract: Hex): "" | "Ambire" | "Metamask";
//# sourceMappingURL=7702.d.ts.map