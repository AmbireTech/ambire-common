import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { SelectedAccountForImport } from '../../interfaces/account';
import { KeyIterator as KeyIteratorInterface } from '../../interfaces/keyIterator';
import { Key } from '../../interfaces/keystore';
/**
 * The maximum number of private keys that can be imported at once (bulk import).
 * Every imported account adds background work (portfolio and account state updates on every
 * network), so the limit is kept low until the performance with more accounts is measured.
 */
export declare const MAX_BULK_PRIVATE_KEYS = 20;
export declare function isValidPrivateKey(value: string): boolean;
export declare const getPrivateKeyFromSeed: (seed: string, seedPassphrase: string | null | undefined, keyIndex: number, hdPathTemplate: HD_PATH_TEMPLATE_TYPE) => string;
/**
 * Brings a private key to a single comparable form (trimmed, lowercase, without the `0x` prefix),
 * so that the same key entered with or without a prefix or in a different case is detected as a duplicate.
 */
export declare const normalizePrivateKey: (privateKey: string) => string;
/**
 * Serves for retrieving a range of addresses/keys from a given seed phrase, a private key
 * or a list of private keys (bulk import). For a list, the key at position N is served at index N.
 */
export declare class KeyIterator implements KeyIteratorInterface {
    #private;
    type: "internal";
    subType: 'seed' | 'private-key';
    constructor(_privKeyOrSeed: string | string[], _seedPassphrase?: string | null);
    /**
     * How many keys the iterator can serve. Only set for private keys, since a seed phrase
     * can derive keys at any index (undefined means there is no limit).
     */
    get keysCount(): number | undefined;
    retrieve(fromToArr: {
        from: number;
        to: number;
    }[], hdPathTemplate?: HD_PATH_TEMPLATE_TYPE): Promise<string[]>;
    retrieveInternalKeys(selectedAccountsForImport: SelectedAccountForImport[], hdPathTemplate: HD_PATH_TEMPLATE_TYPE, keystoreKeys: Key[]): {
        addr: string;
        type: "internal";
        label: string;
        privateKey: string;
        dedicatedToOneSA: boolean;
        meta: {
            createdAt: number;
        };
    }[];
    isSeedMatching(seedPhraseToCompareWith: string, passphraseToCompareWith: string | null): boolean;
}
//# sourceMappingURL=keyIterator.d.ts.map