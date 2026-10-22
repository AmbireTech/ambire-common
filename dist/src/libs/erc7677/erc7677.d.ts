import { Network } from '../../interfaces/network';
import { BaseAccount } from '../account/BaseAccount';
import { UserOperation } from '../userOperation/types';
import { PaymasterCapabilities, PaymasterData, PaymasterEstimationData, PaymasterService } from './types';
export declare const AMBIRE_SWAP_POLICY = "ambireSwapSponsorship";
/**
 * Currently, only the Gnosis chain is sponsored unconditionally
 */
export declare const AMBIRE_NETWORK_WIDE_SPONSORSHIP_POLICY = "ambireGnosisSponsorship";
export declare function getPaymasterService(chainId: bigint, capabilities?: {
    paymasterService?: PaymasterCapabilities | PaymasterService;
}): PaymasterService | undefined;
export declare function getAmbireSponsorshipUrl(relayerUrl: string): string;
export declare function getAmbirePaymasterService(baseAcc: BaseAccount, relayerUrl: string): PaymasterService | undefined;
export declare function getPaymasterStubData(service: PaymasterService, userOp: UserOperation, network: Network): Promise<PaymasterEstimationData>;
export declare function getPaymasterData(service: PaymasterService, userOp: UserOperation, network: Network): Promise<PaymasterData>;
//# sourceMappingURL=erc7677.d.ts.map