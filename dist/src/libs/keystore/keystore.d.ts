import { AESGCMEncrypted, KeystoreEncryptedPayload, MainKey, MainKeyOld, ScryptParams, StoredKey, StoredKeystoreSeed } from '../../interfaces/keystore';
import { ScryptAdapter } from '../scrypt/scryptAdapter';
/**
 * The old encryption method used AES-CTR, which doesn't include authentication and is less secure.
 * The new method uses AES-GCM, which provides confidentiality and integrity through authenticated encryption.
 */
export declare const CIPHER_OLD = "aes-128-ctr";
/**
 * The encryption method used to encrypt secrets, seeds and private keys in the keystore.
 */
export declare const CIPHER = "AES-GCM";
export declare const SCRYPT_PARAMS: {
    N: number;
    r: number;
    p: number;
    dkLen: number;
};
export declare const getBytesForSecret: (secret: string) => Uint8Array<ArrayBufferLike>;
/**
 * Extracts entropy from a BIP39 seed phrase.
 */
export declare const extractEntropyFromSeed: (seed: string) => Uint8Array;
/**
 * Reconstructs a BIP39 seed phrase from entropy and optional passphrase.
 */
export declare const reconstructSeedFromEntropy: (entropy: Uint8Array, passphrase?: string | null) => string;
/**
 * Encrypts data using Web Crypto AES-GCM.
 */
export declare const encryptWithKey: (key: CryptoKey, data: Uint8Array) => Promise<AESGCMEncrypted>;
/**
 * The main key can be encrypted with many secrets (e.g., user password, biometrics-derived key and email vault).
 * This function takes the main key and a secret, and produces an AES-GCM encrypted payload.
 */
export declare const encryptMainKeyWithSecret: (mainKey: CryptoKey, secretKey: Uint8Array<ArrayBuffer>) => Promise<AESGCMEncrypted>;
/**
 * Thrown when a main key could not be unwrapped with the given secret - a wrong password, or a
 * ciphertext that was tampered with. Anything else thrown by an unwrap is a platform failure.
 */
export declare class WrongSecretError extends Error {
    /** What the platform's cipher actually threw, kept for the crash report. */
    readonly thrown: unknown;
    constructor(thrown: unknown);
}
/**
 * The counterpart of `encryptMainKeyWithSecret` - decrypts a main key that was wrapped with a secret.
 * Throws a `WrongSecretError` if the secret is wrong (or the ciphertext was tampered with).
 */
export declare const decryptMainKeyWithSecret: (secretKey: Uint8Array<ArrayBuffer>, aesEncrypted: AESGCMEncrypted) => Promise<MainKey>;
/**
 * As the type is string | AESGCMEncrypted, we need to check if it's a GCM payload or a legacy string payload
 */
export declare const tryParseGcmPayload: (payload: KeystoreEncryptedPayload) => AESGCMEncrypted | null;
/**
 * Decrypts a GCM-encrypted payload using the provided CryptoKey. Returns the decrypted data as a Uint8Array.
 */
export declare const decryptWithKey: (key: CryptoKey, payload: KeystoreEncryptedPayload) => Promise<Uint8Array>;
/**
 * Decrypts a stored seed entry with the main key it was encrypted with. Handles both
 * the entropy bytes seeds are stored as after the GCM migration and the plain mnemonic
 * legacy ones stored before it.
 */
export declare const decryptStoredSeed: (mainKey: MainKey, storedSeed: Pick<StoredKeystoreSeed, "seed" | "seedPassphrase">) => Promise<{
    seed: string;
    seedPassphrase: string | null;
}>;
/**
 * Unwraps the main key of another device from a scanned app data sync payload. Imported
 * as non-extractable and for decryption only, so that its raw bytes never reach the
 * importing app and it cannot be used to encrypt anything - decrypting the synced keys
 * and seeds is all it is ever needed for.
 */
export declare const decryptSyncedMainKeyWithSecret: (secretKey: Uint8Array<ArrayBuffer>, aesEncrypted: AESGCMEncrypted) => Promise<MainKey>;
/**
 * Used during migration to read legacy payloads
 */
export declare const decryptWithKeyOld: (mainKeyOld: MainKeyOld, encryptedData: string) => Promise<Uint8Array>;
/**
 * We cannot!! use decryptWithKey or decryptWithKeyOld directly to decrypt CTR-encrypted seed data,
 * because that would require two method calls, which in turn initializes the AES instance twice and
 * results in different output, due to the counter being reset (starting from 0 on each initialization,
 * while the original encryption method continued the counter from the seed to the seedPassphrase)
 */
export declare const decryptSeedWithKeyOld: (key: MainKey, encryptedSeed: string, encryptedSeedPassphrase: string | null) => Promise<{
    seed: Uint8Array;
    seedPassphrase: Uint8Array | null;
}>;
/**
 * Computes a derived key from the given secret and salt using scrypt, yielding a key that can be used for encryption/decryption.
 *
 * @example - computes a secret key from a password
 */
export declare const deriveSecret: (scryptAdapter: ScryptAdapter, secretValue: string, scryptParams: ScryptParams) => Promise<Uint8Array<ArrayBuffer>>;
/**
 * Migrates legacy AES-CTR encrypted payloads to AES-GCM encryption.
 *
 * If already migrated (i.e., payloads are in GCM format), it returns the original payloads without any changes.
 */
export declare const migrateStoredPayloadsToGCM: (mainKey: MainKey, storedKeys: StoredKey[], storedSeeds: StoredKeystoreSeed[]) => Promise<{
    migratedKeys: StoredKey[];
    migratedSeeds: StoredKeystoreSeed[];
    failedMigrations: {
        keyAddrs: string[];
        seedIds: string[];
    };
    hasMigrated: boolean;
}>;
//# sourceMappingURL=keystore.d.ts.map