import { Account, AccountId } from '../../interfaces/account';
import { Key } from '../../interfaces/keystore';
export declare const DEFAULT_KEY_LABEL_PATTERN: RegExp;
export declare const getDefaultKeyLabel: (prevKeys: Key[], i: number) => string;
export declare const getExistingKeyLabel: (keys: Key[], addr: string, accountPickerType?: Key["type"]) => string | undefined;
export declare const getAccountKeysCount: ({ accountAddr, accounts, keys }: {
    accountAddr: AccountId;
    accounts: Account[];
    keys: Key[];
}) => number;
//# sourceMappingURL=keys.d.ts.map