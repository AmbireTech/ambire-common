"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.migrateStoredPayloadsToGCM = exports.deriveSecret = exports.decryptSeedWithKeyOld = exports.decryptWithKeyOld = exports.decryptSyncedMainKeyWithSecret = exports.decryptStoredSeed = exports.decryptWithKey = exports.tryParseGcmPayload = exports.decryptMainKeyWithSecret = exports.WrongSecretError = exports.encryptMainKeyWithSecret = exports.encryptWithKey = exports.reconstructSeedFromEntropy = exports.extractEntropyFromSeed = exports.getBytesForSecret = exports.SCRYPT_PARAMS = exports.CIPHER = exports.CIPHER_OLD = void 0;
const tslib_1 = require("tslib");
const aes_js_1 = tslib_1.__importDefault(require("aes-js"));
const ethers_1 = require("ethers");
const wait_1 = tslib_1.__importDefault(require("../../utils/wait"));
/**
 * The old encryption method used AES-CTR, which doesn't include authentication and is less secure.
 * The new method uses AES-GCM, which provides confidentiality and integrity through authenticated encryption.
 */
exports.CIPHER_OLD = 'aes-128-ctr';
/**
 * The encryption method used to encrypt secrets, seeds and private keys in the keystore.
 */
exports.CIPHER = 'AES-GCM';
// TODO: We need only 32 bytes (256 bits) for the AES-GCM key, but scrypt is currently deriving 64 bytes.
// Maybe we can optimize this in the future by deriving only 32 bytes.
exports.SCRYPT_PARAMS = { N: 131072, r: 8, p: 1, dkLen: 64 };
const getBytesForSecret = (secret) => {
    // see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
    return (0, ethers_1.toUtf8Bytes)(secret, 'NFKC');
};
exports.getBytesForSecret = getBytesForSecret;
/**
 * Extracts entropy from a BIP39 seed phrase.
 */
const extractEntropyFromSeed = (seed) => {
    if (!ethers_1.Mnemonic.isValidMnemonic(seed)) {
        throw new Error('keystore: cannot extract entropy from invalid seed phrase');
    }
    const mnemonic = ethers_1.Mnemonic.fromPhrase(seed);
    return (0, ethers_1.getBytes)(mnemonic.entropy);
};
exports.extractEntropyFromSeed = extractEntropyFromSeed;
/**
 * Reconstructs a BIP39 seed phrase from entropy and optional passphrase.
 */
const reconstructSeedFromEntropy = (entropy, passphrase) => {
    const mnemonic = ethers_1.Mnemonic.fromEntropy(entropy, passphrase || undefined);
    return mnemonic.phrase;
};
exports.reconstructSeedFromEntropy = reconstructSeedFromEntropy;
/**
 * Encrypts data using Web Crypto AES-GCM.
 */
const encryptWithKey = async (key, data) => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt({ name: exports.CIPHER, iv, tagLength: 128 }, key, new Uint8Array(data));
    const encryptedBytes = new Uint8Array(encrypted);
    return {
        ciphertext: (0, ethers_1.hexlify)(encryptedBytes),
        iv: (0, ethers_1.hexlify)(iv),
        cipherType: exports.CIPHER
    };
};
exports.encryptWithKey = encryptWithKey;
/**
 * The main key can be encrypted with many secrets (e.g., user password, biometrics-derived key and email vault).
 * This function takes the main key and a secret, and produces an AES-GCM encrypted payload.
 */
const encryptMainKeyWithSecret = async (mainKey, secretKey) => {
    // Generate a crypto key out of the derived secret, so that we can use it for web crypto ops
    const importedSecretKey = await crypto.subtle.importKey('raw', 
    // use 256 bits (first 32 bytes)
    secretKey.slice(0, 32), { name: exports.CIPHER }, true, ['encrypt', 'decrypt']);
    const exportedMainKeyUint8Array = new Uint8Array(await crypto.subtle.exportKey('raw', mainKey));
    return (0, exports.encryptWithKey)(importedSecretKey, exportedMainKeyUint8Array);
};
exports.encryptMainKeyWithSecret = encryptMainKeyWithSecret;
/**
 * Thrown when a main key could not be unwrapped with the given secret - a wrong password, or a
 * ciphertext that was tampered with. Anything else thrown by an unwrap is a platform failure.
 */
class WrongSecretError extends Error {
    /** What the platform's cipher actually threw, kept for the crash report. */
    thrown;
    constructor(thrown) {
        super('keystore: could not decrypt the main key with this secret');
        this.name = 'WrongSecretError';
        this.thrown = thrown;
    }
}
exports.WrongSecretError = WrongSecretError;
/**
 * The counterpart of `encryptMainKeyWithSecret` - decrypts a main key that was wrapped with a secret.
 * Throws a `WrongSecretError` if the secret is wrong (or the ciphertext was tampered with).
 */
const decryptMainKeyWithSecret = async (secretKey, aesEncrypted) => {
    const importedSecretKey = await crypto.subtle.importKey('raw', 
    // use 256 bits (first 32 bytes)
    secretKey.slice(0, 32), { name: exports.CIPHER }, false, ['encrypt', 'decrypt']);
    // Only the cipher is wrapped, so a key import failing or malformed stored data stays an
    // unexpected failure rather than being reported to the user as a wrong password
    const iv = new Uint8Array((0, ethers_1.getBytes)(aesEncrypted.iv));
    const ciphertext = new Uint8Array((0, ethers_1.getBytes)(aesEncrypted.ciphertext));
    let decrypted;
    try {
        decrypted = await crypto.subtle.decrypt({ name: exports.CIPHER, iv, tagLength: 128 }, importedSecretKey, ciphertext);
    }
    catch (error) {
        throw new WrongSecretError(error);
    }
    return crypto.subtle.importKey('raw', decrypted.slice(0, 32), { name: exports.CIPHER }, true, [
        'encrypt',
        'decrypt'
    ]);
};
exports.decryptMainKeyWithSecret = decryptMainKeyWithSecret;
/**
 * As the type is string | AESGCMEncrypted, we need to check if it's a GCM payload or a legacy string payload
 */
const tryParseGcmPayload = (payload) => {
    if (!payload || typeof payload === 'string')
        return null;
    if (payload.cipherType === undefined)
        return null;
    if (payload.cipherType !== exports.CIPHER)
        throw new Error('keystore: unsupported payload cipherType');
    if (typeof payload.iv !== 'string' || typeof payload.ciphertext !== 'string') {
        throw new Error('keystore: invalid gcm payload shape');
    }
    return payload;
};
exports.tryParseGcmPayload = tryParseGcmPayload;
/**
 * Decrypts a GCM-encrypted payload using the provided CryptoKey. Returns the decrypted data as a Uint8Array.
 */
const decryptWithKey = async (key, payload) => {
    if (!(key instanceof CryptoKey))
        throw new Error('keystore: key is not a CryptoKey');
    const maybeGcmPayload = (0, exports.tryParseGcmPayload)(payload);
    if (!maybeGcmPayload) {
        // Not a valid GCM, but also not a valid legacy payload
        if (typeof payload !== 'string') {
            throw new Error('keystore: invalid payload type for decryption');
        }
        const exported = await crypto.subtle.exportKey('raw', key);
        // key is first 16, iv is second 16 bytes of the exported key material
        const mainKeyOld = {
            key: new Uint8Array(exported.slice(0, 16)),
            iv: new Uint8Array(exported.slice(16, 32))
        };
        const decrypted = await (0, exports.decryptWithKeyOld)(mainKeyOld, payload);
        return decrypted;
    }
    const decrypted = await crypto.subtle.decrypt({
        name: exports.CIPHER,
        iv: new Uint8Array((0, ethers_1.getBytes)(maybeGcmPayload.iv)),
        tagLength: 128
    }, key, new Uint8Array((0, ethers_1.getBytes)(maybeGcmPayload.ciphertext)));
    return new Uint8Array(decrypted);
};
exports.decryptWithKey = decryptWithKey;
/**
 * Decrypts a stored seed entry with the main key it was encrypted with. Handles both
 * the entropy bytes seeds are stored as after the GCM migration and the plain mnemonic
 * legacy ones stored before it.
 */
const decryptStoredSeed = async (mainKey, storedSeed) => {
    const seedBytes = await (0, exports.decryptWithKey)(mainKey, storedSeed.seed);
    let seedPassphrase = null;
    if (storedSeed.seedPassphrase) {
        const seedPassphraseBytes = await (0, exports.decryptWithKey)(mainKey, storedSeed.seedPassphrase);
        seedPassphrase = new TextDecoder().decode(seedPassphraseBytes) || null;
    }
    // Seeds after the GCM migration are stored as entropy bytes, so the mnemonic has to
    // be reconstructed from them. Legacy ones decrypt to the mnemonic itself.
    if (typeof storedSeed.seed !== 'string')
        return { seed: (0, exports.reconstructSeedFromEntropy)(seedBytes, seedPassphrase), seedPassphrase };
    const seed = new TextDecoder().decode(seedBytes);
    if (!ethers_1.Mnemonic.isValidMnemonic(seed))
        throw new Error('keystore: invalid seed stored');
    return { seed, seedPassphrase };
};
exports.decryptStoredSeed = decryptStoredSeed;
/**
 * Unwraps the main key of another device from a scanned app data sync payload. Imported
 * as non-extractable and for decryption only, so that its raw bytes never reach the
 * importing app and it cannot be used to encrypt anything - decrypting the synced keys
 * and seeds is all it is ever needed for.
 */
const decryptSyncedMainKeyWithSecret = async (secretKey, aesEncrypted) => {
    const importedSecretKey = await crypto.subtle.importKey('raw', 
    // use 256 bits (first 32 bytes)
    secretKey.slice(0, 32), { name: exports.CIPHER }, false, ['decrypt']);
    // As in `decryptMainKeyWithSecret`, only the cipher counts as a wrong secret
    let decrypted;
    try {
        decrypted = await (0, exports.decryptWithKey)(importedSecretKey, aesEncrypted);
    }
    catch (error) {
        throw new WrongSecretError(error);
    }
    return crypto.subtle.importKey('raw', decrypted.slice(0, 32), { name: exports.CIPHER }, false, [
        'decrypt'
    ]);
};
exports.decryptSyncedMainKeyWithSecret = decryptSyncedMainKeyWithSecret;
/**
 * Used during migration to read legacy payloads
 */
const decryptWithKeyOld = async (mainKeyOld, encryptedData) => {
    const counter = new aes_js_1.default.Counter(mainKeyOld.iv);
    const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(mainKeyOld.key, counter);
    return aesCtr.decrypt((0, ethers_1.getBytes)(encryptedData));
};
exports.decryptWithKeyOld = decryptWithKeyOld;
/**
 * We cannot!! use decryptWithKey or decryptWithKeyOld directly to decrypt CTR-encrypted seed data,
 * because that would require two method calls, which in turn initializes the AES instance twice and
 * results in different output, due to the counter being reset (starting from 0 on each initialization,
 * while the original encryption method continued the counter from the seed to the seedPassphrase)
 */
const decryptSeedWithKeyOld = async (key, encryptedSeed, encryptedSeedPassphrase) => {
    const exported = await crypto.subtle.exportKey('raw', key);
    // key is first 16, iv is second 16 bytes of the exported key material
    const mainKeyOld = {
        key: new Uint8Array(exported.slice(0, 16)),
        iv: new Uint8Array(exported.slice(16, 32))
    };
    const counter = new aes_js_1.default.Counter(mainKeyOld.iv);
    const aesCtr = new aes_js_1.default.ModeOfOperation.ctr(mainKeyOld.key, counter);
    const decryptedSeed = aesCtr.decrypt((0, ethers_1.getBytes)(encryptedSeed));
    const decryptedSeedPassphrase = encryptedSeedPassphrase
        ? aesCtr.decrypt((0, ethers_1.getBytes)(encryptedSeedPassphrase))
        : null;
    return { seed: decryptedSeed, seedPassphrase: decryptedSeedPassphrase };
};
exports.decryptSeedWithKeyOld = decryptSeedWithKeyOld;
/**
 * Computes a derived key from the given secret and salt using scrypt, yielding a key that can be used for encryption/decryption.
 *
 * @example - computes a secret key from a password
 */
const deriveSecret = async (scryptAdapter, secretValue, scryptParams) => {
    const { salt, N, r, p, dkLen } = scryptParams;
    const shouldYieldAroundScrypt = !scryptAdapter.runsOffCallerThread;
    if (shouldYieldAroundScrypt)
        await (0, wait_1.default)(0);
    const secretKey = await scryptAdapter.scrypt((0, exports.getBytesForSecret)(secretValue), (0, ethers_1.getBytes)(salt), {
        N,
        r,
        p,
        dkLen
    });
    if (shouldYieldAroundScrypt)
        await (0, wait_1.default)(0);
    return secretKey;
};
exports.deriveSecret = deriveSecret;
/**
 * Migrates legacy AES-CTR encrypted payloads to AES-GCM encryption.
 *
 * If already migrated (i.e., payloads are in GCM format), it returns the original payloads without any changes.
 */
const migrateStoredPayloadsToGCM = async (mainKey, storedKeys, storedSeeds) => {
    const failedMigrations = { keyAddrs: [], seedIds: [] };
    let hasMigrated = false;
    const migratedKeys = await Promise.all(storedKeys.map(async (storedKey) => {
        try {
            const isNotInternalKey = storedKey.type !== 'internal' || !storedKey.privKey;
            const isAlreadyMigrated = typeof storedKey.privKey !== 'string';
            if (isNotInternalKey || isAlreadyMigrated)
                return storedKey;
            const decryptedKey = await (0, exports.decryptWithKey)(mainKey, storedKey.privKey);
            if ((0, ethers_1.getBytes)(decryptedKey).length !== 32) {
                throw new Error(`decrypted private key has invalid length: expected 32 bytes, got ${(0, ethers_1.getBytes)(decryptedKey).length} bytes`);
            }
            const migratedPrivKey = await (0, exports.encryptWithKey)(mainKey, (0, ethers_1.getBytes)(decryptedKey));
            // Flip the flag after the async operation to ensure it doesn't fail
            hasMigrated = true;
            return {
                ...storedKey,
                privKey: migratedPrivKey
            };
        }
        catch (e) {
            console.error(`Failed to migrate key with addr ${storedKey.addr} to AES-GCM encryption:`, e);
            failedMigrations.keyAddrs.push(storedKey.addr);
            return storedKey;
        }
    }));
    const migratedSeeds = await Promise.all(storedSeeds.map(async (storedSeed) => {
        try {
            const isAlreadyMigrated = typeof storedSeed.seed !== 'string';
            if (isAlreadyMigrated)
                return storedSeed;
            const { seed: decryptedSeedBytes, seedPassphrase: decryptedSeedPassphrase } = await (0, exports.decryptSeedWithKeyOld)(mainKey, storedSeed.seed, storedSeed.seedPassphrase);
            const decryptedSeedString = new TextDecoder().decode(decryptedSeedBytes);
            // Convert to entropy bytes, which is the raw form of the seed phrase without the mnemonic encoding
            const entropy = (0, exports.extractEntropyFromSeed)(decryptedSeedString);
            const migratedSeed = {
                ...storedSeed,
                seed: await (0, exports.encryptWithKey)(mainKey, entropy),
                seedPassphrase: decryptedSeedPassphrase
                    ? await (0, exports.encryptWithKey)(mainKey, decryptedSeedPassphrase)
                    : null
            };
            // Flip the flag after the async operations to ensure they don't fail
            hasMigrated = true;
            return migratedSeed;
        }
        catch (e) {
            console.error(`Failed to migrate seed with id ${storedSeed.id} to AES-GCM encryption:`, e);
            failedMigrations.seedIds.push(storedSeed.id);
            return storedSeed;
        }
    }));
    return {
        migratedKeys,
        migratedSeeds,
        failedMigrations,
        hasMigrated
    };
};
exports.migrateStoredPayloadsToGCM = migrateStoredPayloadsToGCM;
//# sourceMappingURL=keystore.js.map