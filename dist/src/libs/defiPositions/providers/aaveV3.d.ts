import { JsonRpcProvider, Provider } from 'ethers';
import { Network } from '../../../interfaces/network';
import { PositionsByProvider } from '../types';
export declare function getAAVEPositions(userAddr: string, provider: Provider | JsonRpcProvider, network: Network): Promise<PositionsByProvider | null>;
//# sourceMappingURL=aaveV3.d.ts.map