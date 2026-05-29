import { Account, AccountOnchainState } from '../../interfaces/account';
import { Key } from '../../interfaces/keystore';
import { Network } from '../../interfaces/network';
import { RPCProvider } from '../../interfaces/provider';
export declare function getAccountState(provider: RPCProvider, network: Network, accounts: Account[], keys: Key[], blockTag?: string | number): Promise<AccountOnchainState[]>;
//# sourceMappingURL=accountState.d.ts.map