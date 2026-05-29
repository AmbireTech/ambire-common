import { TransactionRequest } from 'ethers';
import { Key, KeystoreSignerInterface } from '../../interfaces/keystore';
import { TypedMessageUserRequest } from '../../interfaces/userRequest';
export declare class KeystoreSigner implements KeystoreSignerInterface {
    #private;
    key: Key;
    constructor(_key: Key, _privKey?: string);
    signRawTransaction(params: TransactionRequest): Promise<string>;
    signTypedData(typedMessage: TypedMessageUserRequest['meta']['params']): Promise<string>;
    signMessage(hex: string): Promise<string>;
    sendTransaction(transaction: TransactionRequest): Promise<import("ethers").TransactionResponse>;
    sign7702: KeystoreSignerInterface['sign7702'];
    signTransactionTypeFour: KeystoreSignerInterface['signTransactionTypeFour'];
    /**
     * Gets account public encryption key computed from entropy associated with
     * the specified user account, using the nacl implementation of the
     * X25519_XSalsa20_Poly1305 algorithm.
     */
    getEncryptionPublicKey: KeystoreSignerInterface['getEncryptionPublicKey'];
    /**
     * Decrypt a message (encrypted by the encryption public key).
     */
    decrypt: KeystoreSignerInterface['decrypt'];
}
//# sourceMappingURL=keystoreSigner.d.ts.map