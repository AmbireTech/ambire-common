import gasTankFeeTokens from '../../consts/gasTankFeeTokens';
import { Network } from '../../interfaces/network';
import { GetOptions, SuspectedType, TokenResult } from './interfaces';
export declare const isSuspectedRegardsKnownAddresses: (tokenAddr: string, tokenSymbol: string, chainId: bigint) => boolean;
/**
 * Signs of real-world (fiat) currencies. Scam tokens put them in their symbol, e.g. "$" or
 * "€500", so that a received amount looks like cash. Crypto signs such as "₿" are left out
 * on purpose.
 */
export declare const FIAT_CURRENCY_SIGNS: ReadonlySet<string>;
/**
 * ISO 4217 codes of widely used fiat currencies. A token whose whole symbol is one of them
 * pretends to be that currency. KRW, CAD and PLN are left out on purpose, because real tokens
 * (KROWN, Caduceus Protocol, PLEARN) use them as their symbol.
 */
export declare const FIAT_CURRENCY_CODES: ReadonlySet<string>;
/**
 * Returns true when a token symbol looks like real money: it is exactly a fiat currency
 * code (e.g. "USD"), a fiat currency sign alone (e.g. "$"), or a sign before or after an
 * amount, a fiat currency code, or both, with any text after them (e.g. "$100", "1.000€",
 * "$100K", "$USD", "$100 USD", "$100 PEPE").
 * Checks the raw symbol, because `removeNonLatinChars` drops most currency signs.
 * NFKC folds look-alike variants such as the full-width "＄" into their plain form.
 */
export declare const isFiatLikeSymbol: (symbol: string) => boolean;
export declare const isSuspectedToken: (address: string, symbol: string, chainId: bigint) => SuspectedType;
/**
 * Look up a gas-tank fee token by address and chain in O(1)
 */
export declare function getFeeToken(address: string, chainid: bigint): (typeof gasTankFeeTokens)[number] | undefined;
export declare function getFlags(networkData: any, chainId: string, tokenChainId: bigint, address: string, name: string, symbol: string, hasSimulationAmount?: boolean): TokenResult['flags'];
export declare const mapToken: (token: Pick<TokenResult, "amount" | "decimals" | "name" | "symbol">, network: Network, address: string, opts: Pick<GetOptions, "specialErc20Hints" | "blockTag">, hasSimulationAmount?: boolean, latestAmount?: bigint) => TokenResult;
//# sourceMappingURL=tokenProcessing.d.ts.map