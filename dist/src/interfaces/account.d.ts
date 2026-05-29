import { ControllerInterface } from './controller';
import { Hex } from './hex';
import { Key } from './keystore';
import { Network } from './network';
export type IAccountsController = ControllerInterface<InstanceType<typeof import('../controllers/accounts/accounts').AccountsController>>;
export type AccountId = string;
export type AccountPreferences = {
    label: string;
    pfp: string;
};
export interface Account {
    addr: AccountId;
    associatedKeys: string[];
    initialPrivileges: [string, string][];
    creation: AccountCreation | null;
    safeCreation?: SafeAccountCreation;
    preferences: AccountPreferences;
    email?: string;
    newlyAdded?: boolean;
    disable7702Popup?: boolean;
    disable7702Banner?: boolean;
    /**
     * Timestamp when the identity was fetched from the Ambire Relayer, needed to
     * determine if the account is EOA or Ambire smart account (and set the
     * correct creation, associatedKeys and initialPrivileges).
     */
    identityFetchedAt?: number;
}
export interface AccountCreation {
    factoryAddr: string;
    bytecode: string;
    salt: string;
    /** Timestamp when the identity was created on the Ambire Relayer */
    identityCreatedAt?: number;
}
export interface SafeAccountCreation {
    factoryAddr: Hex;
    singleton: Hex;
    saltNonce: Hex;
    setupData: Hex;
    version: string;
}
export interface AmbireSmartAccountIdentityCreateRequest {
    associatedKeys: Account['initialPrivileges'];
    creation: {
        factoryAddr: string;
        salt: string;
        baseIdentityAddr: string;
    };
    email?: string | undefined;
    addr: Account['addr'];
}
export type AmbireSmartAccountIdentityCreateResponse = {
    success: boolean;
    body: {
        identity: string;
        status: {
            created: boolean;
            reason?: string;
        };
    }[];
};
/**
 * Identity response from the Ambire Relayer. All fields are optional since
 * the response may be null/undefined for EOAs or missing data.
 */
export interface AccountIdentityResponse {
    /** The factory address used to create the identity */
    identityFactoryAddr?: AccountCreation['factoryAddr'];
    /** The bytecode of the identity contract */
    bytecode?: AccountCreation['bytecode'];
    /** The salt used during identity creation */
    salt?: AccountCreation['salt'];
    /** Object whose keys are the associated key addresses */
    associatedKeys?: Account['associatedKeys'];
}
export interface AccountOnchainState {
    accountAddr: string;
    isDeployed: boolean;
    eoaNonce: bigint | null;
    nonce: bigint;
    erc4337Nonce: bigint;
    associatedKeys: string[];
    importedAccountKeys: Key[];
    balance: bigint;
    isEOA: boolean;
    isErc4337Enabled: boolean;
    isErc4337Nonce: boolean;
    isV2: boolean;
    currentBlock: bigint;
    isSmarterEoa: boolean;
    delegatedContract: Hex | null;
    delegatedContractName: 'AMBIRE' | 'METAMASK' | 'UNKNOWN' | null;
    threshold: number;
    updatedAt: number;
}
export type AccountStates = {
    [accountId: string]: {
        [chainId: string]: AccountOnchainState;
    };
};
type AccountDerivationMeta = {
    slot: number;
    index: number;
    isLinked: boolean;
};
export type AccountWithNetworkMeta = Account & {
    /**
     * - undefined - loading
     * - null - won't be fetched
     * - array - fetched
     */
    usedOnNetworks?: Network[] | null;
};
/**
 * The account that is derived programmatically and internally by Ambire.
 * Could be either a basic (EOA) account, a derived with custom derivation
 * basic (EOA) account (used for smart account key only) or a smart account.
 */
export type DerivedAccount = AccountDerivationMeta & {
    account: AccountWithNetworkMeta;
};
export type DerivedAccountWithoutNetworkMeta = Omit<DerivedAccount, 'account'> & {
    account: Account;
};
/**
 * Enum for tracking the import status of an account during the import process.
 */
export declare enum ImportStatus {
    NotImported = "not-imported",
    ImportedWithoutKey = "imported-without-key",// as a view only account
    ImportedWithSomeOfTheKeys = "imported-with-some-of-the-keys",// imported with
    ImportedWithTheSameKeys = "imported-with-the-same-keys",// imported with all
    ImportedWithDifferentKeys = "imported-with-different-keys"
}
/**
 * All the accounts that should be visible on the current page - the Basic
 * Accounts, Smart Accounts and the linked accounts. Excludes the derived
 * EOA (basic) accounts used for smart account keys only.
 */
export type AccountOnPage = DerivedAccount & {
    importStatus: ImportStatus;
};
/**
 * The account that the user has actively chosen (selected) via the app UI.
 * It's always one of the visible accounts returned by the accountsOnPage().
 * Could be either a basic (EOA) account, a smart account or a linked account.
 */
export type SelectedAccountForImport = {
    account: Account;
    isLinked: AccountDerivationMeta['isLinked'];
    accountKeys: (Omit<AccountDerivationMeta, 'isLinked'> & {
        addr: Account['addr'];
    })[];
};
export {};
//# sourceMappingURL=account.d.ts.map