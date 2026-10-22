"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAppDataSyncPayload = exports.serializeAppDataSyncPayload = exports.getAppDataSyncKeyAddrs = exports.AppDataSyncNewerVersionError = exports.APP_DATA_SYNC_PAYLOAD_VERSION = exports.APP_DATA_SYNC_UR_TYPE = void 0;
const ethers_1 = require("ethers");
const pako_1 = require("pako");
const keystore_1 = require("../keystore/keystore");
const networks_1 = require("../networks/networks");
const richJson_1 = require("../richJson/richJson");
/**
 * The UR type used to transport the app data sync payload over animated QR codes.
 * Kept from when only accounts were synced, so that older app versions can still read it.
 */
exports.APP_DATA_SYNC_UR_TYPE = 'ambire-account-sync';
/**
 * 2 added the settings, networks and contacts and allowed syncing no accounts at all. An older
 * app rejects it rather than taking the accounts and silently dropping the rest.
 */
exports.APP_DATA_SYNC_PAYLOAD_VERSION = 2;
/** Accounts and their keys only, which every version of the payload still holds the same way */
const ACCOUNTS_ONLY_PAYLOAD_VERSION = 1;
/** Thrown for a payload exported by a newer app, so the user can be told to update this one */
class AppDataSyncNewerVersionError extends Error {
    constructor(version) {
        super(`appDataSync: payload version ${version} is newer than this app supports`);
        this.name = 'AppDataSyncNewerVersionError';
    }
}
exports.AppDataSyncNewerVersionError = AppDataSyncNewerVersionError;
/**
 * The keys that travel along with the selected accounts. A Safe's owners are accounts
 * of their own, so their keys travel only if the user selected those accounts as well.
 */
const getAppDataSyncKeyAddrs = (accounts) => Array.from(new Set(accounts
    .filter((account) => !account.safeCreation)
    .flatMap((account) => account.associatedKeys)));
exports.getAppDataSyncKeyAddrs = getAppDataSyncKeyAddrs;
const requireGcmPayload = (payload, what) => {
    if (!(0, keystore_1.tryParseGcmPayload)(payload))
        throw new Error(`appDataSync: ${what} is not encrypted with ${keystore_1.CIPHER}`);
};
const validateSecret = (secret) => {
    if (!secret || secret.id !== 'password')
        throw new Error('appDataSync: missing the password protected main key');
    // Deriving the key allocates 128 * N * r bytes, so the scanned params are pinned to the
    // ones every Ambire product uses, instead of letting a hostile QR code ask for gigabytes
    const { salt, N, r, p, dkLen } = secret.scryptParams || {};
    const hasValidScryptParams = typeof salt === 'string' &&
        N === keystore_1.SCRYPT_PARAMS.N &&
        r === keystore_1.SCRYPT_PARAMS.r &&
        p === keystore_1.SCRYPT_PARAMS.p &&
        dkLen === keystore_1.SCRYPT_PARAMS.dkLen;
    if (!hasValidScryptParams)
        throw new Error('appDataSync: invalid scrypt params');
    requireGcmPayload(secret.aesEncrypted, 'the main key');
};
/**
 * Recomputes the address the factory deploys for the scanned bytecode, the same way the
 * AccountPicker does for linked accounts, so a scanned account cannot claim to be an
 * address it isn't. Safe accounts are left out, because deriving their address needs the
 * factory's proxy creation code, which is only available over an RPC call.
 */
const validateAccountCreation = (account) => {
    const { factoryAddr, bytecode, salt } = account.creation;
    if (!(0, ethers_1.isAddress)(factoryAddr) || !(0, ethers_1.isHexString)(bytecode) || !(0, ethers_1.isHexString)(salt, 32))
        throw new Error(`appDataSync: invalid creation data for account ${account.addr}`);
    if ((0, ethers_1.getCreate2Address)(factoryAddr, salt, (0, ethers_1.keccak256)(bytecode)).toLowerCase() !==
        account.addr.toLowerCase())
        throw new Error(`appDataSync: account ${account.addr} does not match its creation data`);
};
const isPrivilege = (privilege) => Array.isArray(privilege) && (0, ethers_1.isAddress)(privilege[0]) && (0, ethers_1.isHexString)(privilege[1]);
const validateAccounts = (accounts) => {
    if (!Array.isArray(accounts))
        throw new Error('appDataSync: invalid accounts');
    accounts.forEach((account) => {
        if (!account || !(0, ethers_1.isAddress)(account.addr))
            throw new Error('appDataSync: invalid account addr');
        if (!Array.isArray(account.associatedKeys) || !account.associatedKeys.every(ethers_1.isAddress))
            throw new Error('appDataSync: invalid account associatedKeys');
        if (!Array.isArray(account.initialPrivileges) || !account.initialPrivileges.every(isPrivilege))
            throw new Error('appDataSync: invalid account initialPrivileges');
        if (!account.preferences?.label)
            throw new Error('appDataSync: invalid account preferences');
        if (account.creation)
            return validateAccountCreation(account);
        // An EOA is controlled by its own address only, so anything else means the scanned
        // account was tampered with. Safe accounts have no `creation`, but do list their owners
        if (!account.safeCreation &&
            (account.associatedKeys.length !== 1 ||
                account.associatedKeys[0].toLowerCase() !== account.addr.toLowerCase()))
            throw new Error(`appDataSync: account ${account.addr} has unexpected associatedKeys`);
    });
};
const validateKeys = (keys) => {
    if (!Array.isArray(keys))
        throw new Error('appDataSync: invalid keys');
    keys.forEach((key) => {
        if (!key || !(0, ethers_1.isAddress)(key.addr))
            throw new Error('appDataSync: invalid key addr');
        if (typeof key.type !== 'string')
            throw new Error('appDataSync: invalid key type');
        if (key.type === 'internal')
            return requireGcmPayload(key.privKey, `key ${key.addr}`);
        // External keys are stored on the hardware device, so there is nothing to encrypt
        if (key.privKey !== null)
            throw new Error(`appDataSync: external key ${key.addr} has a privKey`);
    });
};
const validateSeeds = (seeds) => {
    if (!Array.isArray(seeds))
        throw new Error('appDataSync: invalid seeds');
    seeds.forEach((seed) => {
        if (!seed?.id)
            throw new Error('appDataSync: invalid seed id');
        requireGcmPayload(seed.seed, `seed ${seed.id}`);
        if (seed.seedPassphrase)
            requireGcmPayload(seed.seedPassphrase, `seed passphrase ${seed.id}`);
    });
};
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
const validateSettings = (settings) => {
    if (settings === undefined)
        return;
    if (!isPlainObject(settings))
        throw new Error('appDataSync: invalid settings');
    const { featureFlags, disabledSwapProviderIds, app } = settings;
    if (!isPlainObject(featureFlags) ||
        !Object.values(featureFlags).every((v) => typeof v === 'boolean'))
        throw new Error('appDataSync: invalid feature flags');
    if (!Array.isArray(disabledSwapProviderIds) ||
        !disabledSwapProviderIds.every((id) => typeof id === 'string'))
        throw new Error('appDataSync: invalid disabled swap providers');
    if (!isPlainObject(app) ||
        !Object.values(app).every((v) => typeof v === 'string' || typeof v === 'boolean'))
        throw new Error('appDataSync: invalid app settings');
};
const validateNetworks = (networks) => {
    if (networks === undefined)
        return;
    if (!Array.isArray(networks) || !networks.every(networks_1.sanityCheckImportantNetworkProperties))
        throw new Error('appDataSync: invalid networks');
};
const validateContacts = (contacts) => {
    if (contacts === undefined)
        return;
    if (!Array.isArray(contacts))
        throw new Error('appDataSync: invalid contacts');
    contacts.forEach((contact) => {
        if (!contact || !(0, ethers_1.isAddress)(contact.address))
            throw new Error('appDataSync: invalid contact address');
        if (typeof contact.name !== 'string' || !contact.name.trim())
            throw new Error(`appDataSync: invalid name of contact ${contact.address}`);
    });
};
/**
 * A payload takes a few hundred bytes per account, so this leaves room for far more
 * accounts than anyone holds, while keeping a hostile QR code from inflating into
 * gigabytes of memory in the background.
 */
const MAX_DECOMPRESSED_PAYLOAD_SIZE = 2 * 1024 * 1024;
/**
 * Inflates the scanned bytes, giving up as soon as they expand past what a sync payload
 * could ever be, instead of allocating whatever the compressed data asks for.
 */
const decompress = (bytes) => {
    const inflate = new pako_1.Inflate();
    const chunks = [];
    let size = 0;
    // pako has no way to abort a stream, so oversized chunks are counted and dropped
    // (which keeps the memory flat) and the whole stream is rejected afterwards
    inflate.onData = (chunk) => {
        size += chunk.length;
        if (size <= MAX_DECOMPRESSED_PAYLOAD_SIZE)
            chunks.push(chunk);
    };
    inflate.push(bytes, true);
    if (inflate.err)
        throw new Error(`appDataSync: failed to decompress the payload: ${inflate.msg}`);
    if (size > MAX_DECOMPRESSED_PAYLOAD_SIZE)
        throw new Error('appDataSync: the payload is too large to be a sync payload');
    const decompressed = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => {
        decompressed.set(chunk, offset);
        offset += chunk.length;
    });
    return decompressed;
};
/**
 * Serializes the payload to the hex encoded bytes carried by the animated QR codes.
 * Gzipped first, because JSON full of hex strings compresses 3x or better, and every
 * byte saved is one less QR frame the other device has to catch. Rich JSON, because
 * the networks hold bigints.
 */
const serializeAppDataSyncPayload = (payload) => (0, ethers_1.hexlify)((0, pako_1.gzip)((0, ethers_1.toUtf8Bytes)((0, richJson_1.stringify)(payload))));
exports.serializeAppDataSyncPayload = serializeAppDataSyncPayload;
/**
 * Parses and validates the bytes assembled from the scanned animated QR codes.
 * Throws if the payload is incomplete, tampered with or produced by an
 * incompatible (newer) app version.
 */
const parseAppDataSyncPayload = (bytes) => {
    // Left to throw on its own, so that a corrupt stream and an oversized one stay
    // distinguishable from data that decompressed fine but isn't a sync payload
    const decompressed = decompress(bytes);
    let payload;
    try {
        payload = (0, richJson_1.parse)((0, ethers_1.toUtf8String)(decompressed));
    }
    catch {
        throw new Error('appDataSync: the scanned data is not a valid sync payload');
    }
    if (Number.isInteger(payload?.v) && payload.v > exports.APP_DATA_SYNC_PAYLOAD_VERSION)
        throw new AppDataSyncNewerVersionError(payload.v);
    if (payload?.v !== exports.APP_DATA_SYNC_PAYLOAD_VERSION && payload?.v !== ACCOUNTS_ONLY_PAYLOAD_VERSION)
        throw new Error(`appDataSync: unsupported payload version ${payload?.v}`);
    validateAccounts(payload.accounts);
    validateKeys(payload.keys);
    validateSeeds(payload.seeds);
    validateSecret(payload.secret);
    validateSettings(payload.settings);
    validateNetworks(payload.networks);
    validateContacts(payload.contacts);
    const hasSomethingToSync = !!payload.accounts.length || !!payload.settings || !!payload.networks || !!payload.contacts;
    if (!hasSomethingToSync)
        throw new Error('appDataSync: nothing to sync in the payload');
    return payload;
};
exports.parseAppDataSyncPayload = parseAppDataSyncPayload;
//# sourceMappingURL=appDataSync.js.map