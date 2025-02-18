import { Provider } from 'ethers';
import { Account, AccountOnchainState } from '../../interfaces/account';
import { Network } from '../../interfaces/network';
export declare function getAccountState(provider: Provider, network: Network, accounts: Account[], blockTag?: string | number): Promise<AccountOnchainState[]>;
//# sourceMappingURL=accountState.d.ts.map