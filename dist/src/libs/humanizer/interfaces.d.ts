import { Account } from '../../interfaces/account';
import { Network, NetworkId } from '../../interfaces/network';
import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
export type HumanizerVisualization = ({
    type: 'address' | 'label' | 'action' | 'danger' | 'deadline' | 'chain' | 'message' | 'image' | 'link' | 'text';
    url?: string;
    address?: string;
    content?: string;
    value?: bigint;
    warning?: boolean;
    chainId?: bigint;
    messageContent?: Uint8Array | string;
} | {
    type: 'token';
    address: string;
    value: bigint;
    chainId?: bigint;
}) & {
    isHidden?: boolean;
    id: number;
    content?: string;
    isBold?: boolean;
};
export interface IrCall extends Call {
    fullVisualization?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
}
export interface IrMessage extends Message {
    fullVisualization?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
}
export interface HumanizerWarning {
    content: string;
    level?: 'caution' | 'alert' | 'alarm';
}
export interface Ir {
    calls: IrCall[];
    messages: IrMessage[];
}
export interface HumanizerCallModule {
    (AccountOp: AccountOp, calls: IrCall[], humanizerMeta: HumanizerMeta, options?: HumanizerOptions): IrCall[];
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
    name?: string;
    token?: {
        symbol: string;
        decimals: number;
        networks?: string[];
    };
    isSC?: {
        abiName?: string;
    };
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
export interface HumanizerOptions {
    network?: Network;
    networkId?: NetworkId;
}
export type DataToHumanize = AccountOp | Message;
export type KnownAddressLabels = {
    [key in Account['addr']]: string;
};
//# sourceMappingURL=interfaces.d.ts.map