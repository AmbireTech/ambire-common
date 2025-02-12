import { CollectionResult as CollectionResultInterface, NetworkSimulatedAccountOp, NetworkState, TokenResult as TokenResultInterface } from '../libs/portfolio/interfaces';
/** A stripped version of the portfolio state that will be used in the UI */
export type SelectedAccountPortfolioState = {
    [networkId: string]: (Omit<NetworkState, 'result'> & {
        result?: Omit<NonNullable<NetworkState['result']>, 'tokens' | 'collections' | 'tokenErrors' | 'hintsFromExternalAPI' | 'priceCache'>;
    }) | undefined;
};
export type SelectedAccountPortfolioTokenResult = TokenResultInterface & {
    latestAmount?: bigint;
    pendingAmount?: bigint;
};
export interface SelectedAccountPortfolio {
    tokens: SelectedAccountPortfolioTokenResult[];
    collections: CollectionResultInterface[];
    totalBalance: number;
    /** Either all portfolio networks have loaded or a timeout has been reached and there are tokens.
     * @example - If the user has 3 networks and 2 of them have loaded, but the third has not and a timeout has been reached
     * the value of isReadyToVisualize will be true.
     */
    isReadyToVisualize: boolean;
    /** True after all networks have loaded */
    isAllReady: boolean;
    networkSimulatedAccountOp: NetworkSimulatedAccountOp;
    latest: SelectedAccountPortfolioState;
    pending: SelectedAccountPortfolioState;
}
//# sourceMappingURL=selectedAccount.d.ts.map