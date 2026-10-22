import { Hex } from 'viem';
import { HumanizerErc7730Row, HumanizerMeta, HumanizerVisualization, HumanizerWarning, IrCall } from './interfaces';
export type HexIrCall = IrCall & {
    data: Hex;
};
/** Type guard that narrows an IrCall to one with a valid hex data field. */
export declare function isHexCall(call: IrCall): call is HexIrCall;
export declare function getWarning(content: string, code: HumanizerWarning['code'], blocking?: boolean, address?: string): HumanizerWarning;
/**
 * Removes repeated warnings, keeping the first of each kind. Warnings for the same call can come
 * from more than one source (a humanizer module and an ERC-7730 descriptor), so the same concern
 * can be reported twice. Two warnings are the same only when their code, text and address all
 * match - warnings that share a code but say different things are all kept.
 */
export declare const dedupeWarnings: (warnings: HumanizerWarning[]) => HumanizerWarning[];
/**
 * Adds warnings to the ones a call already carries, without repeating any. Modules run one after
 * another over the same call, so a module must never replace what an earlier one found. Returns
 * undefined when there is nothing to report, so calls without warnings keep their original shape.
 */
export declare const mergeWarnings: (existingWarnings: HumanizerWarning[] | undefined, addedWarnings: HumanizerWarning[]) => HumanizerWarning[] | undefined;
/**
 * Marks an approval that has no spending limit. `SignAccountOpController` removes warnings with
 * this code when the app that made the request is in the default Ambire catalog, so every module
 * that reports an unlimited approval must use this exact code.
 */
export declare const UNLIMITED_APPROVAL_WARNING_CODE = "UNLIMITED_APPROVAL";
/**
 * True when the amount is the largest value its type can hold. Contracts use this value to mean
 * "no limit". Only the exact maximum counts, so a large but finite approval is not reported.
 */
export declare const isUnlimitedAmount: (amount: bigint, bits?: 256 | 160) => boolean;
/**
 * Warns that an approval lets the spender take any amount of the token, with no limit. The address
 * is lowercased to match `getAddressVisualization`, so both spellings of it compare as equal.
 */
export declare const getUnlimitedApprovalWarning: (spender: string) => HumanizerWarning;
export declare const randomId: () => number;
export declare function getLabel(content: string | bigint | number, isBold?: boolean): HumanizerVisualization;
export declare function getAction(content: string, options?: {
    warning?: boolean;
}): HumanizerVisualization;
export declare function getImage(content: string): HumanizerVisualization;
export declare function getBreak(): HumanizerVisualization;
export declare function getAddressVisualization(_address: string): HumanizerVisualization;
export declare function getToken(_address: string, amount: bigint, chainId?: bigint): HumanizerVisualization;
export declare function getTokenWithChain(address: string, amount: bigint, chainId?: bigint): HumanizerVisualization;
export declare function getChain(chainId: bigint): HumanizerVisualization;
export declare function getText(text: string, mlMi?: boolean): HumanizerVisualization;
/** The visualizations a row renders - a `call` row keeps its parts flat, every other row has one. */
export declare function getErc7730RowValues(row: HumanizerErc7730Row): HumanizerVisualization[];
/** A `call` row renders an embedded call inline and has no label of its own. */
export declare function getErc7730RowLabel(row: HumanizerErc7730Row): string;
export declare function getErc7730Visualization(intent: string | undefined, rows: HumanizerErc7730Row[], dapp?: IrCall['dapp'], interpolated?: {
    parts: HumanizerVisualization[];
    usedFieldPaths: string[];
}): HumanizerVisualization;
export declare function flattenHumanizerVisualizations(visualizations?: HumanizerVisualization[]): HumanizerVisualization[];
export declare function hasErc7730Humanization(humanization?: IrCall[]): boolean;
export declare function getOnBehalfOf(onBehalfOf: string, sender: string): HumanizerVisualization[];
export declare function getRecipientText(from: string, recipient: string): HumanizerVisualization[];
export declare function getDeadlineText(deadline: bigint): string;
export declare function getDeadline(deadlineSecs: bigint | number): HumanizerVisualization;
export declare function getLink(url: string, content: string): HumanizerVisualization;
export declare function getWrapping(address: string, amount: bigint): HumanizerVisualization[];
export declare function getUnwrapping(address: string, amount: bigint): HumanizerVisualization[];
export declare function getKnownName(humanizerMeta: HumanizerMeta | undefined, address: string): string | undefined;
export declare function getKnownFunctionName(humanizerMeta: HumanizerMeta | undefined, selector: string): string | undefined;
export declare const EMPTY_HUMANIZER_META: {
    abis: {
        NO_ABI: {};
    };
    knownAddresses: {};
};
export declare const uintToAddress: (uint: bigint) => string;
export declare const eToNative: (address: string) => string;
export declare const padCallData: (data: Hex, staticArgsCount: number) => Hex;
//# sourceMappingURL=utils.d.ts.map