import { HD_PATH_TEMPLATE_TYPE } from '../../consts/derivation';
import { SelectedAccountForImport } from '../../interfaces/account';
import { KeyIterator as KeyIteratorInterface } from '../../interfaces/keyIterator';
import { Key } from '../../interfaces/keystore';
export declare function isValidPrivateKey(value: string): boolean;
export declare const getPrivateKeyFromSeed: (seed: string, seedPassphrase: string | null | undefined, keyIndex: number, hdPathTemplate: HD_PATH_TEMPLATE_TYPE) => string;
/**
 * Serves for retrieving a range of addresses/keys from a given private key or seed phrase
 */
export declare class KeyIterator implements KeyIteratorInterface {
    #private;
    type: "internal";
    subType: 'seed' | 'private-key';
    constructor(_privKeyOrSeed: string, _seedPassphrase?: string | null);
    getEncryptedSeed(encryptor: (seed: string, seedPassphrase?: string | null | undefined) => Promise<{
        seed: string;
        passphrase: string | null;
    }>): Promise<{
        seed: string;
        passphrase: string | null;
    } | null>;
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
    isSeedMatching(seedPhraseToCompareWith: string): boolean;
}
//# sourceMappingURL=keyIterator.d.ts.map