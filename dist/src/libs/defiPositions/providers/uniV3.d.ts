import { JsonRpcProvider, Provider } from 'ethers';
import { Network } from '../../../interfaces/network';
import { RPCProvider } from '../../../interfaces/provider';
import { PositionsByProvider } from '../types';
export declare function getUniV3Positions(userAddr: string, provider: Provider | JsonRpcProvider, network: Network): Promise<PositionsByProvider | null>;
export declare function getDebankEnhancedUniV3Positions(addr: string, provider: RPCProvider, network: Network, previousPositions: PositionsByProvider[], debankNetworkPositionsByProvider: PositionsByProvider[], isDebankCallSuccessful: boolean): Promise<PositionsByProvider | null>;
//# sourceMappingURL=uniV3.d.ts.map