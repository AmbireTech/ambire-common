import { Network } from '../../interfaces/network';
import { UserOperation } from '../userOperation/types';
import { PaymasterCapabilities, PaymasterData, PaymasterEstimationData, PaymasterService } from './types';
export declare function getPaymasterService(chainId: bigint, capabilities?: {
    paymasterService?: PaymasterCapabilities;
}): PaymasterService | undefined;
export declare function getPaymasterStubData(service: PaymasterService, userOp: UserOperation, network: Network): Promise<PaymasterEstimationData>;
export declare function getPaymasterData(service: PaymasterService, userOp: UserOperation, network: Network): Promise<PaymasterData>;
//# sourceMappingURL=erc7677.d.ts.map