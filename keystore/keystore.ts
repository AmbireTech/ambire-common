import aes from "aes-js";
import scrypt from "scrypt-js";
import { arrayify, isHexString, keccak256, randomBytes, toUtf8Bytes, UnicodeNormalizationForm } from 'ethers/lib/utils'

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
	salt: Uint8Array;
	N: number;
	r: number;
	p: number;
	dkLen: number;
}

type AESEncrypted = {
	cipherType: "aes-128-ctr";
	ciphertext: string;
	cipheriv: Uint8Array;
	mac: string;
}

type MainKeyEncryptedWithSecret = {
	id: string,
	scryptParams: ScryptParams;
	aesEncrypted: AESEncrypted;
}

// Not using class here because we can't encapsulate mainKey securely
export class Keystore {
	// @TODO: string?
	#mainKey: string | null;
	storage: Storage;
	constructor(_storage: Storage) {
		this.storage = _storage;
		this.#mainKey = null;
	}
	// @TODO time
	async unlockWithSecret(secretId: string, secret: string) {
		const secrets: [MainKeyEncryptedWithSecret] = await this.storage.get('keystoreSecrets', [])
		if (!secrets.length) throw new Error('keystore: no secrets yet')
		const secretEntry = secrets.find(x => x.id === secretId)
		if (!secretEntry) throw new Error(`keystore: secret ${secretId} not found`)
		console.log(secrets)
	}
	async addSecret(secretId: string, secret: string) {
		// @TODO passwordbytes
		const salt = randomBytes(32)
		console.log(await scrypt.scrypt(getBytesForSecret(secret), salt, 262144, 8, 1, 64, () => {}))
	}
}
function getBytesForSecret(secret: string): ArrayLike<number> {
	// see https://github.com/ethers-io/ethers.js/blob/v5/packages/json-wallets/src.ts/utils.ts#L19-L24
	return toUtf8Bytes(secret, UnicodeNormalizationForm.NFKC)
}

const keystore = new Keystore(produceMemoryStore())
console.log(keystore)
// @TODO test
console.log((keystore as any)['#mainKey'])

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
		console.log(e)
	}

	await keystore.addSecret('passphrase', pass)
}
main().then(() => console.log('OK'))
