import { TransactionRequest } from 'ethers';
import { Key, KeystoreSigner as KeystoreSignerInterface } from '../../interfaces/keystore';
import { TypedMessage } from '../../interfaces/userRequest';
export declare class KeystoreSigner implements KeystoreSignerInterface {
    #private;
    key: Key;
    constructor(_key: Key, _privKey?: string);
    signRawTransaction(params: TransactionRequest): Promise<string>;
    signTypedData(typedMessage: TypedMessage): Promise<string>;
    signMessage(hex: string): Promise<string>;
    sendTransaction(transaction: TransactionRequest): Promise<import("ethers").TransactionResponse>;
}
//# sourceMappingURL=keystoreSigner.d.ts.map