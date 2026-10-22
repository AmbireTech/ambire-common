import { Interface } from 'ethers';
import { Hex } from '../../interfaces/hex';
/** The entrypoint's native deposit, which carries the amount as the call's value. */
export declare const NATIVE_DEPOSIT_SIGNATURE = "deposit(uint256)";
/** The entrypoint's ERC-20 deposit, which pulls the amount with `transferFrom`. */
export declare const ERC20_DEPOSIT_SIGNATURE = "deposit(address,uint256,uint256)";
/** The entrypoint's two deposit functions. */
export declare const ENTRYPOINT_DEPOSIT_INTERFACE: Interface;
export type PrivacyPoolsDepositCall = {
    precommitment: bigint;
    /** In the SDK's convention: native is `PRIVACY_POOLS_NATIVE_ASSET_ADDRESS`. */
    assetAddress: string;
    amount: bigint;
};
/**
 * Decodes an entrypoint deposit call. The precommitment ties it to the receiving account. Null for
 * any other or undecodable call.
 */
export declare const readPrivacyPoolsDeposit: ({ data, value }: {
    data: string;
    value: bigint;
}) => PrivacyPoolsDepositCall | null;
/** Encodes a deposit call - the inverse of `readPrivacyPoolsDeposit`. */
export declare const encodePrivacyPoolsDeposit: ({ isNative, assetAddress, amount, precommitment }: {
    isNative: boolean;
    /** The wallet's address for the asset; unused for native. */
    assetAddress: string;
    amount: bigint;
    precommitment: bigint;
}) => {
    value: bigint;
    data: Hex;
};
//# sourceMappingURL=deposit.d.ts.map