import { PrivacyPoolsPaymasterWithdrawal } from '../../../privacyPools/paymasterWithdrawal';
import { HumanizerCallModule, IrCall } from '../../interfaces';
/**
 * Shows a Privacy Pools deposit as a send to a Privacy Pools account. The call ties it to the
 * account only by a precommitment, so no account is named.
 */
export declare const privacyPoolsModule: HumanizerCallModule;
/**
 * Shows a withdrawal from a Privacy Pools account as a clear-signing card, with the rows and labels
 * of a swap's. Not a call module: the withdrawal is not a call of the user's account but an
 * ERC-4337 userOp of a single-use sender, so it is described from what `readPaymasterWithdrawal`
 * read out of it, as no ERC-7730 descriptor could.
 *
 * The amount is what leaves the account; the fee comes out of it. The fee locked into the proof is
 * only a cap: the unused part is refunded to the recipient. So when the withdrawal could be
 * simulated, what the recipient gets and the fee are the expected ones; otherwise they are the
 * least the recipient gets and the most the fee can be, and say so.
 *
 * The token is one of the pools' configured assets, so its symbol and decimals go with it and the
 * card shows right away. The fee also carries the token's price, to show what it costs in USD.
 */
export declare const humanizePrivacyPoolsWithdrawal: ({ chainId, withdrawal: { recipient, tokenAddress, amount, fee }, expectedFeeAmount, usdPrice }: {
    chainId: string;
    withdrawal: PrivacyPoolsPaymasterWithdrawal;
    /** The fee the simulation expects, or null when it could not be run. */
    expectedFeeAmount: bigint | null;
    /** USD price of the withdrawn token, or null when unknown. */
    usdPrice: number | null;
}) => IrCall;
//# sourceMappingURL=privacyPoolsModule.d.ts.map