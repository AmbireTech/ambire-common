import { type Hex } from 'viem';
import { HumanizerMeta, HumanizerVisualization, HumanizerWarning, IrCall } from './interfaces';
export type HexIrCall = IrCall & {
    data: Hex;
};
/** Type guard that narrows an IrCall to one with a valid hex data field. */
export declare function isHexCall(call: IrCall): call is HexIrCall;
export declare function getWarning(content: string, code: HumanizerWarning['code'], blocking?: boolean): HumanizerWarning;
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
export declare function getText(text: string): HumanizerVisualization;
export declare function getOnBehalfOf(onBehalfOf: string, sender: string): HumanizerVisualization[];
export declare function getRecipientText(from: string, recipient: string): HumanizerVisualization[];
export declare function getDeadlineText(deadline: bigint): string;
export declare function getDeadline(deadlineSecs: bigint | number): HumanizerVisualization;
export declare function getLink(url: string, content: string): HumanizerVisualization;
export declare function getWrapping(address: string, amount: bigint): HumanizerVisualization[];
export declare function getUnwrapping(address: string, amount: bigint): HumanizerVisualization[];
export declare function getKnownName(humanizerMeta: HumanizerMeta | undefined, address: string): string | undefined;
export declare const EMPTY_HUMANIZER_META: {
    abis: {
        NO_ABI: {};
    };
    knownAddresses: {};
};
export declare const uintToAddress: (uint: bigint) => string;
export declare const eToNative: (address: string) => string;
//# sourceMappingURL=utils.d.ts.map