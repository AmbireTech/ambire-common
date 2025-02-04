import { Account, AccountId, AccountOnPage, AccountPreferences, ImportStatus } from '../../interfaces/account';
import { KeyIterator } from '../../interfaces/keyIterator';
import { Key } from '../../interfaces/keystore';
import { PrivLevels } from '../proxyDeploy/deploy';
/**
 * The minimum requirements are emailFrom and secondaryKey.
 * - emailFrom is the email from the email vault
 * - secondaryKey is the recoveryKey set in the email vault
 * - acceptUnknownSelectors: sets whether recovery can be done by DNSSEC keys
 * - waitUntilAcceptAdded: how much time to wait before the user accepts
 * a DNSSEC key
 * - waitUntilAcceptRemoved: how much time to wait before the user accepts
 * a removal of a DNSSEC key
 * - acceptEmptyDKIMSig: can recovery be performed without DKIM
 * - acceptEmptySecondSig: can recovery be performed without secondaryKey
 * - onlyOneSigTimelock: in case of 1/2 multisig, how much time to wait
 * before the recovery transaction can be executed
 */
interface DKIMRecoveryAccInfo {
    emailFrom: string;
    secondaryKey: string;
    waitUntilAcceptAdded?: BigInt;
    waitUntilAcceptRemoved?: BigInt;
    acceptEmptyDKIMSig?: boolean;
    acceptEmptySecondSig?: boolean;
    onlyOneSigTimelock?: BigInt;
}
export declare function getAccountDeployParams(account: Account): [string, string];
export declare function getBasicAccount(addr: string, existingAccounts: Account[]): Account;
export declare function getSmartAccount(privileges: PrivLevels[], existingAccounts: Account[]): Promise<Account>;
export declare function getSpoof(account: Account): string;
/**
 * Create a DKIM recoverable email smart account
 *
 * @param recoveryInfo DKIMRecoveryAccInfo
 * @param associatedKey the key that has privileges
 * @returns Promise<Account>
 */
export declare function getEmailAccount(recoveryInfo: DKIMRecoveryAccInfo, associatedKey: string): Promise<Account>;
export declare const isAmbireV1LinkedAccount: (factoryAddr?: string) => boolean | "" | undefined;
export declare const isSmartAccount: (account?: Account | null) => boolean;
/**
 * Checks if a (basic) EOA account is a derived one,
 * that is meant to be used as a smart account key only.
 */
export declare const isDerivedForSmartAccountKeyOnly: (index?: number) => boolean;
export declare const getDefaultSelectedAccount: (accounts: Account[]) => Account | null;
export declare const getAccountImportStatus: ({ account, alreadyImportedAccounts, keys, accountsOnPage, keyIteratorType }: {
    account: Account;
    alreadyImportedAccounts: Account[];
    keys: Key[];
    accountsOnPage?: Omit<AccountOnPage, "importStatus">[] | undefined;
    keyIteratorType?: string | undefined;
}) => ImportStatus;
export declare const getDefaultAccountPreferences: (accountAddr: string, prevAccounts: Account[], i?: number) => AccountPreferences;
export declare function migrateAccountPreferencesToAccounts(accountPreferences: {
    [key: AccountId]: AccountPreferences;
}, accounts: Account[]): {
    preferences: AccountPreferences;
    addr: string;
    associatedKeys: string[];
    initialPrivileges: [string, string][];
    creation: import("../../interfaces/account").AccountCreation | null;
    email?: string | undefined;
    newlyCreated?: boolean | undefined;
    newlyAdded?: boolean | undefined;
}[];
export declare function getUniqueAccountsArray(accounts: Account[]): Account[];
export {};
//# sourceMappingURL=account.d.ts.map