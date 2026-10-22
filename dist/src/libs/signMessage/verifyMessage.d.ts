import { JsonRpcProvider } from 'ethers';
import { Hex } from '../../interfaces/hex';
import { TypedMessageUserRequest } from '../../interfaces/userRequest';
type Props = {
    provider: JsonRpcProvider;
    signer: string;
    signature: string | Uint8Array;
} & ({
    message: string | Uint8Array;
    typedData?: never;
    authorization?: never;
} | {
    typedData: TypedMessageUserRequest['meta']['params'];
    message?: never;
    authorization?: never;
} | {
    message?: never;
    typedData?: never;
    authorization: Hex;
});
/**
 * Verifies the signature of a message using the provided signer and signature
 * via a "magic" universal validator contract using the provided provider to
 * verify the signature on-chain. The contract deploys itself within the
 * `eth_call`, tries to verify the signature using ERC-6492, ERC-1271, and
 * `ecrecover`, and returns the value to the function.
 *
 * Note: you only need to pass one of: `message` or `typedData`
 */
export declare function verifyMessage({ provider, signer, signature, message, authorization, typedData }: Props): Promise<boolean>;
export {};
//# sourceMappingURL=verifyMessage.d.ts.map