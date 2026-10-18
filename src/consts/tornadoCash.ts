/**
 * Fixed so a phrase alone recovers its notes, at the cost of one identity per phrase. Never infer
 * another index: a wrong one points the wallet at an empty set of notes.
 */
export const TORNADO_CASH_ACCOUNT_INDEX = 0

/**
 * The account's branch of the SDK's derivation scheme. Below it, the SDK asks for one key per
 * note and kind: `/{kind}'/{depositIndex}'`, where kind is 0 (nullifier), 1 (salt) or 2 (the
 * paymaster withdrawal signer).
 *
 * Security boundary: `KeystoreController.derivePrivacyKey` refuses any other path, since the
 * plugin asks for arbitrary paths and could otherwise reach the user's EVM keys.
 */
export const TORNADO_CASH_ACCOUNT_KEY_PATH = `m/29795'/1'/${TORNADO_CASH_ACCOUNT_INDEX}'`

/** The key kinds the SDK derives per note - see `TORNADO_CASH_ACCOUNT_KEY_PATH`. */
export const TORNADO_CASH_NOTE_KEY_KINDS = [0, 1, 2] as const
