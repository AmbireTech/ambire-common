import { Account, AccountId } from '../../interfaces/account';
import { Fetch } from '../../interfaces/fetch';
import { Network, NetworkId } from '../../interfaces/network';
import { Storage } from '../../interfaces/storage';
import { AccountOp } from '../../libs/accountOp/accountOp';
import { Portfolio } from '../../libs/portfolio';
import { CustomToken, TokenPreference } from '../../libs/portfolio/customToken';
import { AccountAssetsState, AccountState, GetOptions, TemporaryTokens, TokenResult } from '../../libs/portfolio/interfaces';
import { AccountsController } from '../accounts/accounts';
import EventEmitter from '../eventEmitter/eventEmitter';
import { NetworksController } from '../networks/networks';
import { ProvidersController } from '../providers/providers';
export declare class PortfolioController extends EventEmitter {
    #private;
    customTokens: CustomToken[];
    tokenPreferences: TokenPreference[];
    validTokens: any;
    temporaryTokens: TemporaryTokens;
    constructor(storage: Storage, fetch: Fetch, providers: ProvidersController, networks: NetworksController, accounts: AccountsController, relayerUrl: string, velcroUrl: string);
    addCustomToken(customToken: CustomToken, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    removeCustomToken(customToken: Omit<CustomToken, 'standard'>, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    toggleHideToken(tokenPreference: TokenPreference, selectedAccountAddr?: string, shouldUpdatePortfolio?: boolean): Promise<void>;
    removeNetworkData(networkId: NetworkId): void;
    overridePendingResults(accountOp: AccountOp): void;
    updateTokenValidationByStandard(token: {
        address: TokenResult['address'];
        networkId: TokenResult['networkId'];
    }, accountId: AccountId): Promise<void>;
    initializePortfolioLibIfNeeded(accountId: AccountId, networkId: NetworkId, network: Network): Portfolio;
    getTemporaryTokens(accountId: AccountId, networkId: NetworkId, additionalHint: string): Promise<boolean>;
    protected updatePortfolioState(accountId: string, network: Network, portfolioLib: Portfolio, portfolioProps: Partial<GetOptions> & {
        blockTag: 'latest' | 'pending';
    }, forceUpdate: boolean): Promise<boolean>;
    updateSelectedAccount(accountId: AccountId, network?: Network, accountOps?: {
        [key: string]: AccountOp[];
    }, opts?: {
        forceUpdate: boolean;
    }): Promise<void>;
    markSimulationAsBroadcasted(accountId: string, networkId: string): void;
    addTokensToBeLearned(tokenAddresses: string[], networkId: NetworkId): boolean;
    learnTokens(tokenAddresses: string[] | undefined, networkId: NetworkId): Promise<boolean>;
    learnNfts(nftsData: [string, bigint[]][] | undefined, networkId: NetworkId): Promise<boolean>;
    removeAccountData(address: Account['addr']): void;
    getLatestPortfolioState(accountAddr: string): AccountState;
    getPendingPortfolioState(accountAddr: string): AccountState;
    getNetworksWithAssets(accountAddr: string): AccountAssetsState;
    toJSON(): this & {
        emittedErrors: import("../eventEmitter/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=portfolio.d.ts.map