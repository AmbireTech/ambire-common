import { Account, AccountId, AccountOnchainState } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network } from '../../interfaces/network';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { Portfolio } from '../../libs/portfolio';
import { CustomToken, TokenPreference } from '../../libs/portfolio/customToken';
import { AccountAssetsState, AccountState, GetOptions, TemporaryTokens, TokenResult } from '../../libs/portfolio/interfaces';
import { AccountsController } from '../accounts/accounts';
import EventEmitter from '../eventEmitter/eventEmitter';
import { KeystoreController } from '../keystore/keystore';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
import { StorageController } from '../storage/storage';
export declare class PortfolioController extends EventEmitter {
    #private;
    customTokens: CustomToken[];
    tokenPreferences: TokenPreference[];
    validTokens: any;
    temporaryTokens: TemporaryTokens;
    constructor(storage: StorageController, fetch: Fetch, providers: ProvidersController, networks: NetworksController, accounts: AccountsController, keystore: KeystoreController, relayerUrl: string, velcroUrl: string);
    addCustomToken(customToken: CustomToken, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    removeCustomToken(customToken: Omit<CustomToken, 'standard'>, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    toggleHideToken(tokenPreference: TokenPreference, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    removeNetworkData(chainId: bigint): void;
    overridePendingResults(accountOp: AccountOp): void;
    updateTokenValidationByStandard(token: {
        address: TokenResult['address'];
        chainId: TokenResult['chainId'];
    }, accountId: AccountId): Promise<void>;
    initializePortfolioLibIfNeeded(accountId: AccountId, chainId: bigint, network: Network): Portfolio;
    getTemporaryTokens(accountId: AccountId, chainId: bigint, additionalHint: string): Promise<boolean>;
    protected updatePortfolioState(accountId: string, network: Network, portfolioLib: Portfolio, portfolioProps: Partial<GetOptions> & {
        blockTag: 'latest' | 'pending';
    }, forceUpdate: boolean, maxDataAgeMs?: number): Promise<boolean>;
    updateSelectedAccount(accountId: AccountId, network?: Network, simulation?: {
        accountOps: {
            [key: string]: AccountOp[];
        };
        states: {
            [chainId: string]: AccountOnchainState;
        };
    }, opts?: {
        forceUpdate?: boolean;
        maxDataAgeMs?: number;
    }): Promise<void>;
    markSimulationAsBroadcasted(accountId: string, chainId: bigint): void;
    addTokensToBeLearned(tokenAddresses: string[], chainId: bigint): boolean;
    learnTokens(tokenAddresses: string[] | undefined, chainId: bigint): Promise<boolean>;
    learnNfts(nftsData: [string, bigint[]][] | undefined, chainId: bigint): Promise<boolean>;
    removeAccountData(address: Account['addr']): void;
    getLatestPortfolioState(accountAddr: string): AccountState;
    getPendingPortfolioState(accountAddr: string): AccountState;
    getNetworksWithAssets(accountAddr: string): AccountAssetsState;
    simulateAccountOp(op: AccountOp): Promise<void>;
    toJSON(): this & {
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=portfolio.d.ts.map