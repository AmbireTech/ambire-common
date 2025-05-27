import { HumanizerMeta, HumanizerVisualization, HumanizerWarning } from './interfaces';
export declare function getWarning(content: string, level?: HumanizerWarning['level']): HumanizerWarning;
export declare const randomId: () => number;
export declare function getLabel(content: string, isBold?: boolean): HumanizerVisualization;
export declare function getAction(content: string): HumanizerVisualization;
export declare function getImage(content: string): HumanizerVisualization;
export declare function getAddressVisualization(_address: string): HumanizerVisualization;
export declare function getToken(_address: string, amount: bigint, isHidden?: boolean, chainId?: bigint): HumanizerVisualization;
export declare function getTokenWithChain(address: string, amount: bigint, chainId?: bigint): HumanizerVisualization;
export declare function getChain(chainId: bigint): HumanizerVisualization;
export declare function getText(text: string): HumanizerVisualization;
export declare function getOnBehalfOf(onBehalfOf: string, sender: string): HumanizerVisualization[];
export declare function getRecipientText(from: string, recipient: string): HumanizerVisualization[];
export declare function getDeadlineText(deadline: bigint): string;
export declare function getDeadline(deadlineSecs: bigint | number): HumanizerVisualization;
export declare function getLink(url: string, content: string): HumanizerVisualization;
export declare function checkIfUnknownAction(v: HumanizerVisualization[] | undefined): boolean;
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