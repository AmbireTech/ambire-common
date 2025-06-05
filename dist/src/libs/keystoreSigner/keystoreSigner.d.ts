import { TransactionRequest } from 'ethers';
import { EIP7702Auth } from '../../consts/7702';
import { Hex } from '../../interfaces/hex';
import { Key, KeystoreSignerInterface, TxnRequest } from '../../interfaces/keystore';
import { EIP7702Signature } from '../../interfaces/signatures';
import { TypedMessage } from '../../interfaces/userRequest';
export declare class KeystoreSigner implements KeystoreSignerInterface {
    #private;
    key: Key;
    constructor(_key: Key, _privKey?: string);
    signRawTransaction(params: TransactionRequest): Promise<string>;
    signTypedData(typedMessage: TypedMessage): Promise<string>;
    signMessage(hex: string): Promise<string>;
    sendTransaction(transaction: TransactionRequest): Promise<import("ethers").TransactionResponse>;
    sign7702(hex: string): EIP7702Signature;
    signTransactionTypeFour(txnRequest: TxnRequest, eip7702Auth: EIP7702Auth): Hex;
}
//# sourceMappingURL=keystoreSigner.d.ts.map