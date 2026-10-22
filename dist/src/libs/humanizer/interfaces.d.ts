import { Account } from '../../interfaces/account';
import { DecodedCall } from '../../interfaces/decodeCall';
import { BlacklistedStatus } from '../../interfaces/phishing';
import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
export type HumanizerErc7730Row = {
    path?: string;
    /**
     * Draws a divider above the row, setting it and the rows after it apart from the ones above.
     * Off for descriptor rows, which only some humanizer modules group this way.
     */
    hasSeparatorBefore?: boolean;
} & ({
    type: 'call';
    value: HumanizerVisualization[];
} | {
    type: 'single-value';
    label: string;
    value: HumanizerVisualization;
    /** Shown before the value, e.g. '≈' for an estimate. Translated by the UI. */
    valuePrefix?: string;
});
export interface HumanizerErc7730Visualization {
    type: 'erc7730';
    intent: HumanizerVisualization[];
    excludedFieldPaths: string[];
    fields: HumanizerErc7730Row[];
    dapp?: Call['dapp'];
}
export type HumanizerVisualization = ({
    type: 'address' | 'label' | 'action' | 'danger' | 'deadline' | 'chain' | 'image' | 'link' | 'text' | 'break';
    url?: string;
    address?: string;
    content?: string;
    value?: bigint;
    warning?: boolean;
    chainId?: bigint;
} | HumanizerErc7730Visualization | {
    type: 'token';
    address: string;
    value: bigint;
    chainId?: bigint;
    /**
     * The token's symbol and decimals, when the humanizer already knows them for certain. The UI
     * then shows the token right away instead of looking it up.
     */
    tokenInfo?: {
        symbol: string;
        decimals: number;
    };
    /** USD price of one token. When set, the UI shows the amount's USD value next to it. */
    usdPrice?: number;
}) & {
    id: number;
    url?: string;
    address?: string;
    content?: string;
    value?: bigint;
    isBold?: boolean;
    warning?: boolean;
    chainId?: bigint;
    verification?: BlacklistedStatus;
    mlMi?: boolean;
    /**
     * Names the address only from what the wallet already knows (accounts, contacts), with no
     * lookup that sends it out of the wallet.
     */
    isLocalLabelOnly?: boolean;
};
export interface IrCall extends Omit<Call, 'to'> {
    fullVisualization?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
    isFallback?: boolean;
    to?: string;
    /** The call data decoded with the function signature of its selector, when it can be decoded. */
    decodedCall?: DecodedCall;
    /** The call isn't decoded yet because the function signatures it needs are still being fetched. */
    isDecodingCall?: boolean;
    /**
     * Set by a module whose visualization is built from data it verified against the call (e.g. a
     * CoW Swap order that hashes to the order ID in the calldata). Such a visualization shows more
     * than a generic ERC-7730 descriptor can derive from the calldata alone, so it's kept instead
     * of the descriptor's.
     */
    preferredOverErc7730?: boolean;
}
export interface IrMessage extends Message {
    fullVisualization?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
    canHideDropdownArrow?: boolean;
}
export interface HumanizerWarning {
    content: string;
    blocking?: boolean;
    code: string;
    address?: string;
}
export interface Ir {
    calls: IrCall[];
    messages: IrMessage[];
}
export interface HumanizerCallModule {
    (accountOp: AccountOp, call: IrCall, humanizerMeta?: HumanizerMeta): IrCall;
}
export interface HumanizerTypedMessageModule {
    (typedMessage: Message): Omit<IrMessage, keyof Message>;
}
export interface AbiFragment {
    selector: string;
    type: 'error' | 'function' | 'event';
    signature: string;
}
export interface HumanizerMetaAddress {
    logo?: string;
    name?: string;
    token?: {
        symbol: string;
        decimals?: number;
    };
    isSC?: boolean;
    chainIds?: number[];
}
export interface HumanizerMeta {
    abis: {
        [name: string]: {
            [selector: string]: AbiFragment;
        };
        NO_ABI: {
            [selector: string]: AbiFragment;
        };
    };
    knownAddresses: {
        [address: string]: HumanizerMetaAddress;
    };
}
export type DataToHumanize = AccountOp | Message;
export type KnownAddressLabels = {
    [key in Account['addr']]: string;
};
//# sourceMappingURL=interfaces.d.ts.map