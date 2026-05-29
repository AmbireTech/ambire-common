import { AccountOnchainState } from '../../interfaces/account';
import { Hex } from '../../interfaces/hex';
import { HardwareWalletSigningRequest } from '../../interfaces/signAccountOp';
import { AccountOp } from '../accountOp/accountOp';
import { Network } from '../../interfaces/network';
export declare function getSigningRequestDisplayData(request: HardwareWalletSigningRequest): unknown;
export declare function getEIP712SigningRequest(data: unknown): HardwareWalletSigningRequest;
export declare function getRawTransactionSigningRequest(data: unknown): HardwareWalletSigningRequest;
export declare function getExecuteSigningRequest({ accountOp, accountState, network }: {
    accountOp: AccountOp;
    accountState: AccountOnchainState;
    network: Network;
}): HardwareWalletSigningRequest;
export declare function get7702AuthorizationSigningRequest({ chainId, contract, nonce }: {
    chainId: bigint;
    contract: Hex;
    nonce: bigint;
}): HardwareWalletSigningRequest;
//# sourceMappingURL=signingRequest.d.ts.map