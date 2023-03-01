import aes from "aes-js";
import scrypt from "scrypt-js";
import { arrayify, hexlify, isHexString, keccak256, randomBytes, toUtf8Bytes, toUtf8String, UnicodeNormalizationForm, concat } from 'ethers/lib/utils'

// @TODO
// - define all the function signatures
// - tests
// - use the storage interface that ambire-common uses

// DOCS
// - Secrets are strings that are used to encrypt the mainKey; the mainKey could be encrypted with many secrets
// - All individual keys are encrypted with the mainKey
// - The mainKey is kept in memory, but only for the unlockedTime

interface Storage {
	get(key: string, defaultValue: any): Promise<any>;
	set(key: string, value: any): Promise<null>;
}


interface SecretStored {

}
interface KeyStored {
}
interface Key {
}


type ScryptParams = {
	salt: string;
	N: number;
	r: number;
	p: number;
	dkLen: number;
}

type AESEncrypted = {
	cipherType: "aes-128-ctr";
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

// Not using class here because we can't encapsulate mainKey securely
export class Keystore {
	#mainKey: MainKey | null;
	storage: Storage;
	constructor(_storage: Storage) {
		this.storage = _storage;
		this.#mainKey = null;
	}
	// @TODO time before unlocking
	async unlockWithSecret(secretId: string, secret: string) {
		// @TODO should we check if already locked? probably not cause this function can  be used in order to verify if a secret is correct
		const secrets: [MainKeyEncryptedWithSecret] = await this.storage.get('keystoreSecrets', [])
		if (!secrets.length) throw new Error('keystore: no secrets yet')
		const secretEntry = secrets.find(x => x.id === secretId)
		if (!secretEntry) throw new Error(`keystore: secret ${secretId} not found`)
		console.log('secret entry', secretEntry)
		const { scryptParams, aesEncrypted } = secretEntry
		if (aesEncrypted.cipherType !== 'aes-128-ctr') throw Error(`keystore: unsupproted cipherType ${aesEncrypted.cipherType}`)
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
		console.log('mainKey decrypted', this.#mainKey)
	}
	async addSecret(secretId: string, secret: string, extraEntropy: string = '') {
		// @TODO: DRY?
		const secrets: [MainKeyEncryptedWithSecret] = await this.storage.get('keystoreSecrets', [])
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
		console.log('mainKey on addSecret', mainKey)

		const salt = randomBytes(32)
		const key = await scrypt.scrypt(getBytesForSecret(secret), salt, 262144, 8, 1, 64, () => {})
		const iv = randomBytes(16)
		const derivedKey = key.slice(0, 16)
		const macPrefix = key.slice(16, 32)
		const counter = new aes.Counter(iv)
		const aesCtr = new aes.ModeOfOperation.ctr(derivedKey, counter)
		const ciphertext = aesCtr.encrypt(concat([ mainKey.key, mainKey.iv ]))
		const mac = keccak256(concat([ macPrefix, ciphertext ]))

		secrets.push({
			id: secretId,
			scryptParams: { salt: hexlify(salt), N: 262144, r: 8, p: 1, dkLen: 64 },
			aesEncrypted: { cipherType: 'aes-128-ctr', ciphertext: hexlify(ciphertext), iv: hexlify(iv), mac: hexlify(mac) }
		})
		await this.storage.set('keystoreSecrets', secrets)
	}
	lock() {
		this.#mainKey = null
	}
	isUnlocked() {
		return !!this.#mainKey
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
