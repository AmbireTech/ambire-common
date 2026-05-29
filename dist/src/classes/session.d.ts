import { Messenger } from '../interfaces/messenger';
export interface SessionInitProps {
    url?: string;
    tabId?: number;
    windowId?: number;
    wcTopic?: string;
}
export interface SessionProp {
    icon?: string;
    name?: string;
    isWeb3App?: boolean;
}
export declare function getSessionId({ tabId, windowId, dappId }: {
    windowId: SessionInitProps['windowId'];
    tabId: SessionInitProps['tabId'];
    dappId: string;
}): string;
export declare class Session {
    /**
    @state {string} id = the domain of the dapp
     */
    id: string;
    /**
    @state {string} origin = the url of the dapp
     */
    origin: string;
    tabId: number;
    windowId?: number;
    name: string;
    icon: string;
    messenger?: Messenger;
    wcTopic?: string;
    lastHandledRequestIds: {
        [providerId: string]: number;
    };
    isWeb3App: boolean;
    isAmbireNext: boolean;
    sendMessage(event: any, data: any): void;
    constructor({ tabId, windowId, url, wcTopic }?: SessionInitProps);
    setMessenger(messenger: Messenger, isAmbireNext: boolean): void;
    setProp({ icon, name }: SessionProp): void;
    get sessionId(): string;
    toJSON(): this & {
        sessionId: string;
    };
}
//# sourceMappingURL=session.d.ts.map