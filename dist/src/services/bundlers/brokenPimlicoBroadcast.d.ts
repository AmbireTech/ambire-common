import { Network } from '../../interfaces/network';
import { UserOperation } from '../../libs/userOperation/types';
import { Pimlico } from './pimlico';
/**
 * DANGER
 * This class is made purely for the intention of using it for tests
 * where the broadcast fails but everything else should work.
 * When broadcast fails, estimation should switch to biconomy
 * and continue on
 */
export declare class BrokenPimlicoBroadcast extends Pimlico {
    broadcast(userOperation: UserOperation, network: Network): Promise<string>;
}
//# sourceMappingURL=brokenPimlicoBroadcast.d.ts.map