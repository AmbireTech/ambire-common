import { Account, AccountId } from '../../interfaces/account';
import { NetworkId } from '../../interfaces/network';
import { AccountOp } from '../accountOp/accountOp';
export interface Price {
    baseCurrency: string;
    price: number;
}
export interface GetOptionsSimulation {
    accountOps: AccountOp[];
    account: Account;
}
export type TokenError = string | '0x';
export type AccountAssetsState = {
    [networkId: NetworkId]: boolean;
};
export type TokenResult = {
    symbol: string;
    decimals: number;
    address: string;
    networkId: NetworkId;
    amount: bigint;
    simulationAmount?: bigint;
    amountPostSimulation?: bigint;
    priceIn: Price[];
    flags: {
        onGasTank: boolean;
        rewardsType: 'wallet-vesting' | 'wallet-rewards' | null;
        canTopUpGasTank: boolean;
        isFeeToken: boolean;
        isDefiToken?: boolean;
        isHidden?: boolean;
        isCustom?: boolean;
    };
};
export interface CollectionResult extends TokenResult {
    name: string;
    collectibles: bigint[];
    postSimulation?: {
        sending?: bigint[];
        receiving?: bigint[];
    };
}
export type PriceCache = Map<string, [number, Price[]]>;
export type MetaData = {
    blockNumber?: number;
    beforeNonce?: bigint;
    afterNonce?: bigint;
};
export interface ERC721Enumerable {
    isKnown: boolean;
    enumerable: boolean;
}
export interface ERC721Innumerable {
    isKnown: boolean;
    tokens: string[];
}
export interface ERC721s {
    [name: string]: ERC721Enumerable | ERC721Innumerable;
}
export interface Hints {
    erc20s: string[];
    erc721s: ERC721s;
}
export interface ExternalHintsAPIResponse extends Hints {
    lastUpdate: number;
    networkId: string;
    accountAddr: string;
    prices: {
        [name: string]: Price;
    };
    hasHints: boolean;
    error?: string;
}
export type StrippedExternalHintsAPIResponse = Pick<ExternalHintsAPIResponse, 'erc20s' | 'erc721s' | 'lastUpdate'>;
export interface ExtendedError extends Error {
    simulationErrorMsg?: string;
}
type ExtendedErrorWithLevel = ExtendedError & {
    level: 'critical' | 'warning' | 'silent';
};
export interface PortfolioLibGetResult {
    updateStarted: number;
    discoveryTime: number;
    oracleCallTime: number;
    priceUpdateTime: number;
    priceCache: PriceCache;
    tokens: TokenResult[];
    feeTokens: TokenResult[];
    tokenErrors: {
        error: string;
        address: string;
    }[];
    collections: CollectionResult[];
    hintsFromExternalAPI: StrippedExternalHintsAPIResponse | null;
    errors: ExtendedErrorWithLevel[];
    blockNumber: number;
    beforeNonce: bigint;
    afterNonce: bigint;
}
interface Total {
    [currency: string]: number;
}
type AdditionalPortfolioProperties = 'updateStarted' | 'tokens';
export type ClaimableRewardsData = {
    addr: string;
    fromBalanceClaimable: number;
    fromADXClaimable: number;
    totalClaimable: string;
    leaf: string;
    proof: string[];
    root: string;
    signedRoot: string;
};
export type AddrVestingData = {
    addr: string;
    rate: string;
    start: string;
    end: string;
};
export type AdditionalPortfolioNetworkResult = Partial<PortfolioLibGetResult> & Pick<PortfolioLibGetResult, AdditionalPortfolioProperties> & {
    lastSuccessfulUpdate: number;
    total: Total;
    claimableRewardsData?: ClaimableRewardsData;
    addrVestingData?: AddrVestingData;
};
type PortfolioNetworkResult = Required<AdditionalPortfolioNetworkResult>;
export type NetworkState = {
    isReady: boolean;
    isLoading: boolean;
    criticalError?: ExtendedError;
    errors: ExtendedErrorWithLevel[];
    result?: PortfolioNetworkResult | AdditionalPortfolioNetworkResult;
    accountOps?: AccountOp[];
};
export type AccountState = {
    [networkId: string]: NetworkState | undefined;
};
export type PortfolioControllerState = {
    [accountId: string]: AccountState;
};
export interface LimitsOptions {
    erc20: number;
    erc721: number;
    erc721TokensInput: number;
    erc721Tokens: number;
}
export interface Limits {
    deploylessProxyMode: LimitsOptions;
    deploylessStateOverrideMode: LimitsOptions;
}
export type PinnedTokens = {
    networkId: NetworkId;
    address: string;
    onGasTank: boolean;
    accountId?: AccountId;
}[];
export type TemporaryTokens = {
    [networkId: NetworkId]: {
        isLoading: boolean;
        errors: {
            error: string;
            address: string;
        }[];
        result: {
            tokens: PortfolioLibGetResult['tokens'];
        };
    };
};
export interface GetOptions {
    baseCurrency: string;
    blockTag: string | number;
    simulation?: GetOptionsSimulation;
    priceCache?: PriceCache;
    priceRecency: number;
    previousHintsFromExternalAPI?: StrippedExternalHintsAPIResponse | null;
    isEOA: boolean;
    fetchPinned: boolean;
    additionalErc20Hints?: Hints['erc20s'];
    additionalErc721Hints?: Hints['erc721s'];
    disableAutoDiscovery?: boolean;
}
export interface PreviousHintsStorage {
    learnedTokens: {
        [network in NetworkId]: {
            [tokenAddress: string]: string | null;
        };
    };
    learnedNfts: {
        [network in NetworkId]: {
            [nftAddress: string]: bigint[];
        };
    };
    fromExternalAPI: {
        [networkAndAccountKey: string]: GetOptions['previousHintsFromExternalAPI'];
    };
}
export interface NetworkSimulatedAccountOp {
    [networkId: NetworkId]: AccountOp;
}
export type PendingAmounts = {
    isPending: boolean;
    pendingBalance: bigint;
    pendingToBeSigned?: bigint;
    pendingToBeConfirmed?: bigint;
};
export type FormattedPendingAmounts = Omit<PendingAmounts, 'pendingBalance'> & {
    pendingBalance: string;
    pendingBalanceFormatted: string;
    pendingBalanceUSDFormatted?: string;
    pendingToBeSignedFormatted?: string;
    pendingToBeConfirmedFormatted?: string;
};
export {};
//# sourceMappingURL=interfaces.d.ts.map