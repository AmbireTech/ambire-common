import { SubmittedAccountOpLike } from '../accountOp/submittedAccountOp';
/**
 * Account ops sent by the same EOA with the same nonce replace each other (e.g. a speed up),
 * so only one of them can end up onchain. Returns the key they share, or null for ops that
 * can't be replaced this way (e.g. broadcast by a relayer or a bundler, which set no eoaNonce).
 *
 * eoaNonce is the nonce of the EOA that paid for the broadcast (paidBy), which may differ from
 * the account itself (e.g. a smart account paid by one of its EOA keys). Nonces of different
 * EOAs are unrelated, so the payer is part of the key too
 */
export declare const getReplacementKey: (accountOp: Pick<SubmittedAccountOpLike, "chainId" | "gasFeePayment" | "eoaNonce">) => string | null;
/**
 * Keeps one account op per group of ops that replace each other (see getReplacementKey):
 * the one that got onchain (confirmed or failed) or, while none has, the newest one, as it
 * pays the highest fee. The order of the ops is kept
 */
export declare const collapseReplacedAccountOps: <T extends SubmittedAccountOpLike>(accountOps: T[]) => T[];
/**
 * Finds `accountOp` in a list collapsed by collapseReplacedAccountOps. Once it's sped up, only
 * one op of its group is in the list, so the op shown in its place is returned instead: the one
 * that got (or will get) onchain. Ops that can't be replaced are matched by their signature
 */
export declare const findAccountOpOrReplacement: <T extends SubmittedAccountOpLike>(accountOps: T[], accountOp: Pick<SubmittedAccountOpLike, "chainId" | "gasFeePayment" | "eoaNonce" | "signature">) => T | undefined;
//# sourceMappingURL=replacements.d.ts.map