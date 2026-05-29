import { Account } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { AbstractPaymaster } from '../../libs/paymaster/abstractPaymaster';
import { UserOperation } from '../../libs/userOperation/types';
export declare class PaymasterFactory {
    relayerUrl: string | undefined;
    fetch: Fetch | undefined;
    errorCallback: Function | undefined;
    init(relayerUrl: string, fetch: Fetch, errorCallback: Function): void;
    create(op: AccountOp, userOp: UserOperation, account: Account, network: Network, provider: RPCProvider): Promise<AbstractPaymaster>;
}
//# sourceMappingURL=PaymasterFactory.d.ts.map