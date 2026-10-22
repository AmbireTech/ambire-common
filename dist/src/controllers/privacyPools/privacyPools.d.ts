import { IEventEmitterRegistryController } from '../../interfaces/eventEmitter';
import { IFeatureFlagsController } from '../../interfaces/featureFlags';
import { Fetch } from '../../interfaces/fetch';
import { IKeystoreController } from '../../interfaces/keystore';
import { INetworksController } from '../../interfaces/network';
import { IPrivacyPoolsController, PrivacyPoolsAccount, PrivacyPoolsChainState, PrivacyPoolsDepositAssetConfig, PrivacyPoolsOperation, PrivacyPoolsSendForm, PrivacyPoolsTokenBalance, PrivacyPoolsUnavailableReason } from '../../interfaces/privacyPools';
import { IProvidersController } from '../../interfaces/provider';
import { ISelectedAccountController } from '../../interfaces/selectedAccount';
import { IStorageController } from '../../interfaces/storage';
import { IUiController } from '../../interfaces/ui';
import { Call } from '../../libs/accountOp/types';
import { PrivacyPoolsProverFactory } from '../../libs/privacyPools/prover';
import EventEmitter from '../eventEmitter/eventEmitter';
import { PrivacyPoolsDepositParams } from './deposits';
import { PrivacyPoolsWithdrawalParams } from './withdrawal';
/**
 * Privacy Pools state: one plugin per (chain, recovery phrase) and its notes. Scoped by phrase, as note secrets are derived from it - accounts without one (hardware,
 * private key, view-only) cannot use Privacy Pools.
 *
 * The work is done by modules (plugins, sync, deposits, withdrawal, Send form) holding their own
 * state. This stays the only `EventEmitter`: it checks what is available, wires the modules
 * together and reports their state to the UI. See `PrivacyPoolsContext`.
 */
export declare class PrivacyPoolsController extends EventEmitter implements IPrivacyPoolsController {
    #private;
    /**
     * USD prices of the pools' assets, keyed by `getPrivacyPoolsPriceKey`. Not from the portfolio,
     * which has no selected account while a Privacy Pools account is selected.
     */
    prices: {
        [priceKey: string]: number;
    };
    /** At most one per stored recovery phrase, and removed with it. */
    accounts: PrivacyPoolsAccount[];
    initialLoadPromise?: Promise<void>;
    constructor({ keystore, featureFlags, networks, providers, selectedAccount, storage, ui, fetch, circuitsBaseUrl, proverFactory, onAccountsRemoved, eventEmitterRegistry }: {
        keystore: IKeystoreController;
        featureFlags: IFeatureFlagsController;
        networks: INetworksController;
        providers: IProvidersController;
        selectedAccount: ISelectedAccountController;
        storage: IStorageController;
        ui: IUiController;
        fetch: Fetch;
        /** Where the circuit artifacts are served from, as only the platform knows it. */
        circuitsBaseUrl: string;
        /**
         * Proves outside this context (the extension's multi-threaded offscreen document). Absent,
         * proofs run here from `circuitsBaseUrl`.
         */
        proverFactory?: PrivacyPoolsProverFactory;
        onAccountsRemoved: (seedIds: string[]) => Promise<void>;
        eventEmitterRegistry?: IEventEmitterRegistryController;
    });
    /** The SDK's supported chains, narrowed to the user's networks that have a provider. */
    get supportedChainIds(): string[];
    get unavailableReason(): PrivacyPoolsUnavailableReason | null;
    get isAvailableForSelectedAccount(): boolean;
    /** Per chain: the selected account's sync of it, with what this device knows of its shared state. */
    get chains(): {
        [chainId: string]: PrivacyPoolsChainState;
    };
    /**
     * The withdrawal in flight, or the last one until dismissed. Hidden, not dropped, while another
     * phrase is selected: one being sent cannot be stopped, and switching back must show how it
     * went. One not sent yet is dropped on switching - see `PrivacyPoolsWithdrawal.dropUnsent`.
     */
    get operation(): PrivacyPoolsOperation | null;
    /** Whether any chain has completed a scan for the selected phrase. */
    get hasSyncedAnyChain(): boolean;
    /**
     * One row per token per chain. Only `approvedAmount` can be withdrawn; the rest awaits the
     * association set and can only be reclaimed publicly.
     */
    get balances(): {
        [chainId: string]: PrivacyPoolsTokenBalance[];
    };
    /** Entrypoint deposit requirements per `${chainId}:${tokenAddress}` (lowercase), read once. */
    get depositAssetConfigs(): {
        [key: string]: PrivacyPoolsDepositAssetConfig;
    };
    /** The selected account's Send form. Dropped on switching accounts, like the regular one. */
    get sendForm(): PrivacyPoolsSendForm;
    /** Changes when the form is cleared here, so the screen drops what it holds locally. */
    get sendFormResetCounter(): number;
    /** Whether the Send form has anything the user would lose. Reopens the popup on that screen. */
    get hasPersistedSendForm(): boolean;
    /**
     * Reads a chain's notes for the selected account, beside the syncs of other accounts and chains.
     * A repeat call joins the running one - see `PrivacyPoolsSync.queue`.
     */
    syncChain(chainId: string): Promise<void>;
    /**
     * Syncs every supported chain for the selected phrase, however fresh (a refresh).
     *
     * Not in `withStatus`, which refuses a call while the previous one runs: a first read takes
     * minutes, and another account opened meanwhile must still start its sync. Progress is per
     * chain, through `chains`.
     */
    sync(): Promise<void>;
    /**
     * On opening the account, syncs chains older than `SYNC_MAX_AGE_MS`. Not in `withStatus`, as
     * `sync`. Skipped until the phrase, the only way to recover the account, is backed up: the
     * dashboard asks for it before the minutes-long first read.
     */
    syncIfStale(): Promise<void>;
    /**
     * Builds the deposit calls from a wallet account into a Privacy Pools account, for the regular
     * signing flow. Tracked only once broadcast - see `onAccountOpBroadcast`. Deposits are public:
     * the pool stores and emits the sender's address.
     */
    buildDepositCalls(params: PrivacyPoolsDepositParams): Promise<Call[]>;
    /** Reads the entrypoint's deposit requirements for an asset once, into `depositAssetConfigs`. */
    loadDepositAssetConfig(chainId: string, tokenAddress: string): Promise<PrivacyPoolsDepositAssetConfig>;
    /**
     * Marks a broadcast account op's deposits as awaiting the chain, however it was signed. Only
     * those `buildDepositCalls` prepared are recognised, by precommitment - others are not this
     * wallet's. Nothing is persisted, as a local log would link deposits to their withdrawals.
     */
    onAccountOpBroadcast(accountOp: {
        chainId: bigint;
        calls: Call[];
    }): void;
    updateSendForm(update: Partial<PrivacyPoolsSendForm>): void;
    resetSendForm(): void;
    dismissOperation(): void;
    /**
     * Proves a withdrawal without sending it, so the user sees the fee before anything is sent.
     *
     * A single-use sender derived from the phrase submits an ERC-4337 userOp whose gas a paymaster
     * pays, taking a fee from the withdrawn amount - so no user-owned address pays gas.
     *
     * Not in `withStatus`: proving is long. Progress is in `operation`. Leaving the form cancels it -
     * see `PrivacyPoolsWithdrawal.dropUnsent`.
     */
    prepareWithdrawal(params: PrivacyPoolsWithdrawalParams): Promise<void>;
    /**
     * Runs the proved withdrawal again when its confirmation sheet opens a while after it was proved,
     * as in a popup reopened on it, so the sheet shows whether it still goes through and its fee as
     * of now. Like the regular Send's re-estimation. Sending checks it again if it is due by then.
     */
    recheckWithdrawal(): Promise<void>;
    /**
     * Sends the signed withdrawal to the bundler and waits for it. Syncs either way, as a userOp can
     * land after the receipt wait gives up.
     */
    broadcastWithdrawal(): Promise<void>;
    /** Adds a stored phrase's Privacy Pools account. Nothing is derived or synced until opened. */
    addAccount(seedId: string): Promise<void>;
    /** Removes the account, not its funds: re-adding it finds them. */
    removeAccount(seedId: string): Promise<void>;
    destroy(): void;
    toJSON(): this & {
        supportedChainIds: string[];
        unavailableReason: PrivacyPoolsUnavailableReason;
        isAvailableForSelectedAccount: boolean;
        chains: {
            [chainId: string]: PrivacyPoolsChainState;
        };
        balances: {
            [chainId: string]: PrivacyPoolsTokenBalance[];
        };
        hasSyncedAnyChain: boolean;
        operation: PrivacyPoolsOperation;
        depositAssetConfigs: {
            [key: string]: PrivacyPoolsDepositAssetConfig;
        };
        sendForm: PrivacyPoolsSendForm;
        sendFormResetCounter: number;
        hasPersistedSendForm: boolean;
        name: string;
        emittedErrors: import("../../interfaces/eventEmitter").ErrorRef[];
    };
}
//# sourceMappingURL=privacyPools.d.ts.map