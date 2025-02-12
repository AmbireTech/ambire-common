"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeystoreSigner = void 0;
/* eslint-disable new-cap */
const ethers_1 = require("ethers");
class KeystoreSigner {
    key;
    #signer;
    constructor(_key, _privKey) {
        if (!_key)
            throw new Error('keystoreSigner: no key provided in constructor');
        if (!_privKey)
            throw new Error('keystoreSigner: no decrypted private key provided in constructor');
        this.key = _key;
        this.#signer = new ethers_1.Wallet(_privKey);
    }
    async signRawTransaction(params) {
        const sig = await this.#signer.signTransaction(params);
        return sig;
    }
    async signTypedData(typedMessage) {
        // remove EIP712Domain because otherwise signTypedData throws: ambiguous primary types or unused types
        if (typedMessage.types.EIP712Domain) {
            // eslint-disable-next-line no-param-reassign
            delete typedMessage.types.EIP712Domain;
        }
        // @ts-ignore
        const sig = await this.#signer.signTypedData(typedMessage.domain, typedMessage.types, typedMessage.message);
        return sig;
    }
    async signMessage(hex) {
        // interface implementation expects a hex number
        // if something different is passed, we have two options:
        // * throw an error
        // * convert to hex
        // converting to hex is not so straightforward, though
        // you might do ethers.toUtf8Bytes() if it's a string
        // or you might do ethers.toBeHex() for a number with a specific length
        // or you might do ethers.hexlify() if you don't care
        // therefore, it's the job of the client to think what he wants
        // to pass. Throwing an error here might save debuging hours
        if (!(0, ethers_1.isHexString)(hex)) {
            throw new Error('Keystore signer, signMessage: passed value is not a hex');
        }
        return this.#signer.signMessage((0, ethers_1.getBytes)(hex));
    }
    async sendTransaction(transaction) {
        const transactionRes = await this.#signer.sendTransaction(transaction);
        return transactionRes;
    }
}
exports.KeystoreSigner = KeystoreSigner;
//# sourceMappingURL=keystoreSigner.js.map