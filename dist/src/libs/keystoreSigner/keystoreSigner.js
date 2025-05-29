"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KeystoreSigner = void 0;
/* eslint-disable new-cap */
const ethers_1 = require("ethers");
const secp256k1_1 = require("secp256k1");
class KeystoreSigner {
    key;
    #signer;
    // use this key only for sign7702
    #authorizationPrivkey;
    constructor(_key, _privKey) {
        if (!_key)
            throw new Error('keystoreSigner: no key provided in constructor');
        if (!_privKey)
            throw new Error('keystoreSigner: no decrypted private key provided in constructor');
        this.key = _key;
        this.#signer = new ethers_1.Wallet(_privKey);
        if (_privKey) {
            this.#authorizationPrivkey = (0, ethers_1.isHexString)(_privKey) ? _privKey : `0x${_privKey}`;
        }
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
    // eslint-disable-next-line class-methods-use-this
    sign7702(hex) {
        if (!this.#authorizationPrivkey)
            throw new Error('no key to perform sign');
        const data = (0, secp256k1_1.ecdsaSign)((0, ethers_1.getBytes)(hex), (0, ethers_1.getBytes)(this.#authorizationPrivkey));
        const signature = (0, ethers_1.hexlify)(data.signature);
        return {
            yParity: (0, ethers_1.toBeHex)(data.recid, 1),
            r: signature.substring(0, 66),
            s: `0x${signature.substring(66)}`
        };
    }
    signTransactionTypeFour(txnRequest, eip7702Auth) {
        if (!this.#authorizationPrivkey)
            throw new Error('no key to perform sign');
        const maxPriorityFeePerGas = txnRequest.maxPriorityFeePerGas ?? txnRequest.gasPrice;
        const maxFeePerGas = txnRequest.maxFeePerGas ?? txnRequest.gasPrice;
        const txnTypeFourHash = (0, ethers_1.keccak256)((0, ethers_1.concat)([
            '0x04',
            (0, ethers_1.encodeRlp)([
                (0, ethers_1.toBeHex)(txnRequest.chainId),
                txnRequest.nonce !== 0 ? (0, ethers_1.toBeHex)(txnRequest.nonce) : '0x',
                maxPriorityFeePerGas ? (0, ethers_1.toBeHex)(maxPriorityFeePerGas) : '0x',
                maxFeePerGas ? (0, ethers_1.toBeHex)(maxFeePerGas) : '0x',
                txnRequest.gasLimit ? (0, ethers_1.toBeHex)(txnRequest.gasLimit) : '0x',
                txnRequest.to,
                txnRequest.value ? (0, ethers_1.toBeHex)(txnRequest.value) : '0x',
                txnRequest.data,
                [],
                [
                    [
                        eip7702Auth.chainId,
                        eip7702Auth.address,
                        eip7702Auth.nonce === '0x00' ? '0x' : eip7702Auth.nonce,
                        eip7702Auth.yParity === '0x00' ? '0x' : eip7702Auth.yParity,
                        // strip leading zeros
                        (0, ethers_1.toBeHex)(BigInt(eip7702Auth.r)),
                        (0, ethers_1.toBeHex)(BigInt(eip7702Auth.s))
                    ]
                ]
            ])
        ]));
        const data = (0, secp256k1_1.ecdsaSign)((0, ethers_1.getBytes)(txnTypeFourHash), (0, ethers_1.getBytes)(this.#authorizationPrivkey));
        const signature = (0, ethers_1.hexlify)(data.signature);
        const txnTypeFourSignature = {
            yParity: (0, ethers_1.toBeHex)(data.recid, 1),
            r: signature.substring(0, 66),
            s: `0x${signature.substring(66)}`
        };
        return (0, ethers_1.concat)([
            '0x04',
            (0, ethers_1.encodeRlp)([
                (0, ethers_1.toBeHex)(txnRequest.chainId),
                txnRequest.nonce !== 0 ? (0, ethers_1.toBeHex)(txnRequest.nonce) : '0x',
                maxPriorityFeePerGas ? (0, ethers_1.toBeHex)(maxPriorityFeePerGas) : '0x',
                maxFeePerGas ? (0, ethers_1.toBeHex)(maxFeePerGas) : '0x',
                txnRequest.gasLimit ? (0, ethers_1.toBeHex)(txnRequest.gasLimit) : '0x',
                txnRequest.to,
                txnRequest.value ? (0, ethers_1.toBeHex)(txnRequest.value) : '0x',
                txnRequest.data,
                [],
                [
                    [
                        eip7702Auth.chainId,
                        eip7702Auth.address,
                        eip7702Auth.nonce === '0x00' ? '0x' : eip7702Auth.nonce,
                        eip7702Auth.yParity === '0x00' ? '0x' : eip7702Auth.yParity,
                        // strip leading zeros
                        (0, ethers_1.toBeHex)(BigInt(eip7702Auth.r)),
                        (0, ethers_1.toBeHex)(BigInt(eip7702Auth.s))
                    ]
                ],
                txnTypeFourSignature.yParity === '0x00' ? '0x' : txnTypeFourSignature.yParity,
                // strip leading zeros
                (0, ethers_1.toBeHex)(BigInt(txnTypeFourSignature.r)),
                (0, ethers_1.toBeHex)(BigInt(txnTypeFourSignature.s))
            ])
        ]);
    }
}
exports.KeystoreSigner = KeystoreSigner;
//# sourceMappingURL=keystoreSigner.js.map