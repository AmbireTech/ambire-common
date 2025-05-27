/**
 * BIP44 as everyone implements it (MetaMask, Trezor, Lattice, EthersJS),
 * iterating over the `address_index` path out of the 5 levels in BIP44:
 *   m / purpose' / coin_type' / account' / change / address_index
 */
export declare const BIP44_STANDARD_DERIVATION_TEMPLATE = "m/44'/60'/0'/0/<account>";
/**
 * BIP44 as Ledger (Live) currently implements it. They iterate over the
 * `account'` path out of the 5 levels in BIP44:
 *   m / purpose' / coin_type' / account' / change / address_index
 */
export declare const BIP44_LEDGER_DERIVATION_TEMPLATE = "m/44'/60'/<account>'/0/0";
/**
 * Legacy (but popular) one, which is BIP44-like, but not BIP44 exactly and
 * there is no standard that describes it. Closely related to the BIP44
 * standard, but it does not include the last "/0" which is typically used to
 * distinguish between addresses (change addresses). Used previously by
 * Ledger and by other Ethereum wallets like MyEtherWallet (MEW) and MyCrypto.
 */
export declare const LEGACY_POPULAR_DERIVATION_TEMPLATE = "m/44'/60'/0'/<account>";
export type HD_PATH_TEMPLATE_TYPE = typeof BIP44_STANDARD_DERIVATION_TEMPLATE | typeof BIP44_LEDGER_DERIVATION_TEMPLATE | typeof LEGACY_POPULAR_DERIVATION_TEMPLATE;
export interface DerivationOption {
    label: string;
    value: HD_PATH_TEMPLATE_TYPE;
    description: string;
}
export declare const DERIVATION_OPTIONS: DerivationOption[];
/**
 * For basic (EOA) accounts that are Ambire smart account keys use the derived
 * address at index N + x, where N is this derivation offset (this constant),
 * and x is the given <account> index in the derivation (template) path.
 */
export declare const SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET = 100000;
//# sourceMappingURL=derivation.d.ts.map