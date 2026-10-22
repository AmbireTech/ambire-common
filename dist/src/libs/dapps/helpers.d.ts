import { Dapp, DefiLlamaProtocol, RawTrendingToken, TrendingToken } from '../../interfaces/dapp';
import { Platform } from '../../interfaces/platform';
import { UnauthenticatedDapp } from '../../interfaces/signingAuth';
/**
 * Strips the trailing dot(s) a hostname may carry when written in fully-qualified form
 * ("app.example.com."). DNS, TLS and the browser resolve such a host to the exact same site as the
 * dotted-free form, but the WHATWG URL parser keeps the dot, so the resulting string matches none
 * of the canonical forms the wallet compares against - the phishing blacklist, the suspicious
 * hosting list and the stored dApp records. Left unnormalized, appending a single dot is enough to
 * turn a known-malicious dApp into an unknown one.
 */
declare const normalizeHostname: (hostname: string) => string;
/**
 * The dApp's canonical hostname, or `null` when the url is not parsable.
 *
 * Normalization deliberately starts from `new URL().hostname` - the parser already lowercases the
 * host and converts internationalized ones to punycode, which is the form the phishing blacklist
 * and the stored dApp records use. `tldts.getHostname()` also drops the trailing dot, but returns
 * the unicode form of internationalized hostnames, so using it here would silently change the
 * identity of every non-ASCII dApp.
 */
declare const getNormalizedHostnameFromUrl: (url: string) => string | null;
declare const getDappIdFromUrl: (url: string) => string;
declare const getDappIconFromUrl: (url: string, dapps: Dapp[]) => string;
declare const getDomainFromUrl: (url: string) => string;
declare const formatDappName: (name: string) => string;
declare const sortDapps: (a: Dapp, b: Dapp) => number;
declare const modifyDappPropsIfNeeded: (id: string, dappsMap: Map<string, Dapp>, protocol: DefiLlamaProtocol, onModify: (modifiedDapp: Dapp) => void) => void;
declare function getDappNameFromId(id: string): string;
declare function unifyDefiLlamaDappUrl(url: string): string;
/** Whether signing requests can ask for the password/biometrics confirmation - mobile only. */
export declare function isSigningAuthPlatform(platform?: Platform): boolean;
/**
 * Which of these stored dapps the user has not yet confirmed their password/biometrics to sign
 * for, deduplicated and in the order they came in. A dapp the catalog does not know (`undefined`)
 * is skipped: there is nowhere to remember the confirmation, so asking would repeat on every request.
 */
export declare function getUnauthenticatedDapps(dapps: (Dapp | undefined)[]): UnauthenticatedDapp[];
/**
 * Returns the list of all accounts that should be returned to a dapp based on the dapp's
 * account preferences.
 */
export declare function getAccountsForDapp(preferences: Dapp['accountPreferences'], extensionSelectedAccountAddr: string | undefined): string[];
/**
 * Whether a dapp may send requests for the account. A dapp the user connected to only some
 * accounts may use only those. Any other dapp follows the selected account, so it may ask for
 * any account in the wallet.
 */
export declare function isAccountAllowedForDapp(preferences: Dapp['accountPreferences'], accountAddr: string): boolean;
declare function normalizeDappConnection(dapp: Dapp): Dapp;
declare function normalizeTrendingTokens(raw: RawTrendingToken[]): TrendingToken[];
export { normalizeHostname, getNormalizedHostnameFromUrl, getDappIdFromUrl, getDappIconFromUrl, getDomainFromUrl, formatDappName, sortDapps, modifyDappPropsIfNeeded, getDappNameFromId, unifyDefiLlamaDappUrl, normalizeDappConnection, normalizeTrendingTokens };
//# sourceMappingURL=helpers.d.ts.map