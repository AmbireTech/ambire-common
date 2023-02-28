import aes from "aes-js";
import scrypt from "scrypt-js";
import { arrayify, isHexString, keccak256 } from 'ethers/lib/utils'

// @TODO
// - define all the function signatures
// - tests
// - use the storage interface that ambire-common uses

// DOCS
// - Secrets are encrypted versions of the mainKey
// - All individual keys are encrypted with the mainKey
// - The mainKey is kept in memory, but only for the unlockedTime

interface Storage {
	get(key: string, defaultValue: any): Promise<any>;
	set(key: string, value: any): Promise<null>;
}

interface AESEncrypted {
	
}

interface SecretStored {

}
interface KeyStored {
}
interface Key {
}

// Not using class here because we can't encapsulate mainKey securely
export class Keystore {
	// @TODO: string?
	#mainKey?: string;
	storage: Storage;
	constructor(_storage: Storage) {
		this.storage = _storage;
		this.#mainKey = 'very secret'
	}
	// @TODO time
	async unlockWithSecret() {
		const secrets: [SecretStored] = await this.storage.get('keystoreSecrets', [])
		console.log(secrets)
	}
	
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
	await keystore.unlockWithSecret()
}
main().then(() => console.log('OK'))
