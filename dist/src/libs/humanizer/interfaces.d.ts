import { Account } from '../../interfaces/account';
import { BlacklistedStatus } from '../../interfaces/phishing';
import { Message } from '../../interfaces/userRequest';
import { AccountOp } from '../accountOp/accountOp';
import { Call } from '../accountOp/types';
export type HumanizerVisualization = ({
    type: 'address' | 'label' | 'action' | 'danger' | 'deadline' | 'chain' | 'image' | 'link' | 'text' | 'break';
    url?: string;
    address?: string;
    content?: string;
    value?: bigint;
    warning?: boolean;
    chainId?: bigint;
} | {
    type: 'token';
    address: string;
    value: bigint;
    chainId?: bigint;
}) & {
    id: number;
    content?: string;
    isBold?: boolean;
    verification?: BlacklistedStatus;
};
export interface IrCall extends Omit<Call, 'to'> {
    fullVisualization?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
    isFallback?: boolean;
    to?: string;
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
}
export interface Ir {
    calls: IrCall[];
    messages: IrMessage[];
}
export interface HumanizerCallModule {
    (AccountOp: AccountOp, calls: IrCall[], humanizerMeta: HumanizerMeta): IrCall[];
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