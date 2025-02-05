"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET = exports.DERIVATION_OPTIONS = exports.LEGACY_POPULAR_DERIVATION_TEMPLATE = exports.BIP44_LEDGER_DERIVATION_TEMPLATE = exports.BIP44_STANDARD_DERIVATION_TEMPLATE = void 0;
/**
 * BIP44 as everyone implements it (MetaMask, Trezor, Lattice, EthersJS),
 * iterating over the `address_index` path out of the 5 levels in BIP44:
 *   m / purpose' / coin_type' / account' / change / address_index
 */
exports.BIP44_STANDARD_DERIVATION_TEMPLATE = "m/44'/60'/0'/0/<account>";
/**
 * BIP44 as Ledger (Live) currently implements it. They iterate over the
 * `account'` path out of the 5 levels in BIP44:
 *   m / purpose' / coin_type' / account' / change / address_index
 */
exports.BIP44_LEDGER_DERIVATION_TEMPLATE = "m/44'/60'/<account>'/0/0";
/**
 * Legacy (but popular) one, which is BIP44-like, but not BIP44 exactly and
 * there is no standard that describes it. Closely related to the BIP44
 * standard, but it does not include the last "/0" which is typically used to
 * distinguish between addresses (change addresses). Used previously by
 * Ledger and by other Ethereum wallets like MyEtherWallet (MEW) and MyCrypto.
 */
exports.LEGACY_POPULAR_DERIVATION_TEMPLATE = "m/44'/60'/0'/<account>";
exports.DERIVATION_OPTIONS = [
    { label: 'BIP44 Standard (MetaMask, Trezor, Grid+)', value: exports.BIP44_STANDARD_DERIVATION_TEMPLATE },
    { label: 'BIP44 Ledger Live', value: exports.BIP44_LEDGER_DERIVATION_TEMPLATE },
    {
        label: 'Legacy (Ledger, MyEtherWallet, MyCrypto)',
        value: exports.LEGACY_POPULAR_DERIVATION_TEMPLATE
    }
];
/**
 * For basic (EOA) accounts that are Ambire smart account keys use the derived
 * address at index N + x, where N is this derivation offset (this constant),
 * and x is the given <account> index in the derivation (template) path.
 */
exports.SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET = 100000;
//# sourceMappingURL=derivation.js.map