import aes from 'aes-js'
import scrypt from 'scrypt-js'
import { arrayify, hexlify, isHexString, keccak256, randomBytes, toUtf8Bytes, toUtf8String, UnicodeNormalizationForm, concat } from 'ethers/lib/utils'
import { Wallet } from 'ethers'

const scryptDefaults = { N: 262144, r: 8, p: 1, dkLen: 64 }
const CIPHER = 'aes-128-ctr'
const SUPPORTED_KEY_TYPES = ['internal', 'trezor', 'ledger', 'lattice']

// @TODO
// - define all the function signatures
// - tests
// - use the storage interface that ambire-common uses

// DOCS
// - Secrets are strings that are used to encrypt the mainKey; the mainKey could be encrypted with many secrets
// - All individual keys are encrypted with the mainKey
// - The mainKey is kept in memory, but only for the unlockedTime

// Design decisions
// - decided to store all keys in the Keystore, even if the private key itself is not stored there; simply because it's called a Keystore and the name implies the functionality
// - handle HW wallets in it, so that we handle everything uniformly with a single API; also, it allows future flexibility to have the concept of optional unlocking built-in; if we have interactivity, we can add `keystore.signExtraInputRequired(key)` which returns what we need from the user
// - `signWithkey` is presumed to be non-interactive at least from `Keystore` point of view (requiring no extra user inputs). This could be wrong, if hardware wallets require extra input - they normally always do, but with the web SDKs we "outsource" this to the HW wallet software itself; this may not be true on mobile


interface Storage {
	get(key: string, defaultValue: any): Promise<any>;
	set(key: string, value: any): Promise<null>;
}

type ScryptParams = {
	salt: string;
	N: number;
	r: number;
	p: number;
	dkLen: number;
}

type AESEncrypted = {
	cipherType: string
	ciphertext: string;
	iv: string;
	mac: string;
}

type MainKeyEncryptedWithSecret = {
	id: string;
	scryptParams: ScryptParams;
	aesEncrypted: AESEncrypted;
}

type MainKey = {
	key: Uint8Array;
	iv: Uint8Array;
}

type Key = {
	// normally in the form of an Ethereum address
	id: string
	type: string
	label: string
	isExternallyStored: boolean
}
type StoredKey = {
	id: string
	type: string
	label: string
	privKey: string | null
	// denotes additional info like HW wallet derivation path
	meta: object | null
}
// Not using class here because we can't encapsulate mainKey securely
export class Keystore {
	#mainKey: MainKey | null;
	storage: Storage;

	constructor(_storage: Storage) {
		this.storage = _storage;
		this.#mainKey = null;
	}

	lock() {
		this.#mainKey = null
	}
	isUnlocked() {
		return !!this.#mainKey
	}

	async getMainKeyEncryptedWithSecrets(): Promise<MainKeyEncryptedWithSecret[]> {
		return await this.storage.get('keystoreSecrets', [])
	}
	async isReadyToStoreKeys(): Promise<boolean> {
		return (await this.getMainKeyEncryptedWithSecrets()).length > 0
	}

	// @TODO time before unlocking
	async unlockWithSecret(secretId: string, secret: string) {
		// @TODO should we check if already locked? probably not cause this function can  be used in order to verify if a secret is correct
		const secrets = await this.getMainKeyEncryptedWithSecrets()
		if (!secrets.length) throw new Error('keystore: no secrets yet')
		const secretEntry = secrets.find(x => x.id === secretId)
		if (!secretEntry) throw new Error(`keystore: secret ${secretId} not found`)

		const { scryptParams, aesEncrypted } = secretEntry
		if (aesEncrypted.cipherType !== CIPHER) throw Error(`keystore: unsupproted cipherType ${aesEncrypted.cipherType}`)
		// @TODO: progressCallback?
		const key = await scrypt.scrypt(getBytesForSecret(secret), arrayify(scryptParams.salt), scryptParams.N, scryptParams.r, scryptParams.p, scryptParams.dkLen, () => {})
		const iv = arrayify(aesEncrypted.iv)
		const derivedKey = key.slice(0, 16)
		const macPrefix = key.slice(16, 32)
		const counter = new aes.Counter(iv)
		const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
		const mac = keccak256(concat([ macPrefix, aesEncrypted.ciphertext ]))
		if (mac !== aesEncrypted.mac) throw new Error('keystore: wrong secret')
		const decrypted = aesCtr.decrypt(arrayify(aesEncrypted.ciphertext))
		this.#mainKey = { key: decrypted.slice(0, 16), iv: decrypted.slice(16, 32) }
	}
	async addSecret(secretId: string, secret: string, extraEntropy: string = '') {
		const secrets = await this.getMainKeyEncryptedWithSecrets()
		// @TODO test
		if (secrets.find(x => x.id === secretId)) throw new Error(`keystore: trying to add duplicate secret ${secretId}`)

		let mainKey: MainKey | null = this.#mainKey
		// We are not not unlocked
		if (!mainKey) {
			if (!secrets.length) {
				const key = arrayify(keccak256(concat([ randomBytes(32), toUtf8Bytes(extraEntropy) ]))).slice(0, 16)
				mainKey = {
					key,
					iv: randomBytes(16)
				}
			} else throw new Error('keystore: must unlock keystore before adding secret')
		}

		const salt = randomBytes(32)
		const key = await scrypt.scrypt(getBytesForSecret(secret), salt, scryptDefaults.N, scryptDefaults.r, scryptDefaults.p, scryptDefaults.dkLen, () => {})
		const iv = randomBytes(16)
		const derivedKey = key.slice(0, 16)
		const macPrefix = key.slice(16, 32)
		const counter = new aes.Counter(iv)
		const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
		const ciphertext = aesCtr.encrypt(concat([ mainKey.key, mainKey.iv ]))
		const mac = keccak256(concat([ macPrefix, ciphertext ]))

		secrets.push({
			id: secretId,
			scryptParams: { salt: hexlify(salt), ...scryptDefaults },
			aesEncrypted: { cipherType: CIPHER, ciphertext: hexlify(ciphertext), iv: hexlify(iv), mac: hexlify(mac) }
		})
		// Persist the new secrets
		await this.storage.set('keystoreSecrets', secrets)
	}
	async removeSecret(secretId: string) {
		const secrets = await this.getMainKeyEncryptedWithSecrets()
		if (secrets.length <= 1) throw new Error('keystore: there would be no remaining secrets after removal')
		if (!secrets.find(x => x.id === secretId)) throw new Error(`keystore: secret$ ${secretId} not found`)
		await this.storage.set('keystoreSecrets', secrets.filter(x => x.id !== secretId))
	}

	async getKeys(): Promise<Key[]> {
		const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
		return keys
			.map(({ id, label, type }) => ({
				id, label, type, isExternallyStored: type !== 'internal'
			} as Key))
	}

	async addKeyExternallyStored(id: string, type: string, label: string, meta: object) {
		const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
		keys.push({
			id, type, label, meta,
			privKey: null,
		})
		await this.storage.set('keystoreKeys', keys)
	}

	async addKey(privateKey: string, label: string) {
		if (this.#mainKey === null) throw new Error('keystore: needs to be unlocked')

		// Set up the cipher
		const counter = new aes.Counter(this.#mainKey.iv)
		const aesCtr = new aes.ModeOfOperation.ctr(this.#mainKey.key, counter)

		// Store the key
		const wallet = new Wallet(privateKey)
		const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
		keys.push({
			id: wallet.address,
			type: 'internal',
			label,
			// @TODO: consider an MAC?
			privKey: hexlify(aesCtr.encrypt(arrayify(privateKey))),
			meta: null
		})
		await this.storage.set('keystoreKeys', keys)
	}

	async removeKey(id: string) {
		const keys: [StoredKey] = await this.storage.get('keystoreKeys', [])
		if (!keys.find(x => x.id === id)) throw new Error(`keystore: trying to remove key that does not exist ${id}}`)
		this.storage.set('keystoreKeys', keys.filter(x => x.id !== id))
	}
}
function getBytesForSecret(secret: string): ArrayLike<number> {
	// see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
	return toUtf8Bytes(secret, UnicodeNormalizationForm.NFKC)
}

const keystore = new Keystore(produceMemoryStore())
console.log(keystore)
// @TODO test
console.log((keystore as any)['#mainKey'], 'must be undefined')

// Helpers/testing
function produceMemoryStore(): Storage {
	const storage = new Map()
	return {
		get: (key, defaultValue): any => {
			const serialized = storage.get(key)
			return  Promise.resolve(serialized ? JSON.parse(serialized) : defaultValue)
		},
		set: (key, value) => { storage.set(key, JSON.stringify(value)); return Promise.resolve(null) }
	}
}
async function main() {
	const pass = 'hoi'
	try {
		await keystore.unlockWithSecret('passphrase', pass)
	} catch(e) {
		console.log('must return  an error', e)
	}

	// @TODO test
	await keystore.addSecret('passphrase', pass)
	console.log('is unlocked: false', keystore.isUnlocked())
	try {
		await keystore.unlockWithSecret('passphrase', pass+'1')
	} catch(e) {
		console.error('must return an error', e)
	}
	await keystore.unlockWithSecret('passphrase', pass)
	console.log('is unlocked: true', keystore.isUnlocked())
}
main().then(() => console.log('OK'))
