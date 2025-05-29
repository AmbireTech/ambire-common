import { JsonRpcProvider, Provider } from 'ethers';
import { Network } from '../../../interfaces/network';
import { PositionsByProvider } from '../types';
export declare function getUniV3Positions(userAddr: string, provider: Provider | JsonRpcProvider, network: Network): Promise<PositionsByProvider | null>;
//# sourceMappingURL=uniV3.d.ts.map