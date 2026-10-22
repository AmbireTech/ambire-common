import { Messenger } from '../interfaces/messenger';
export interface SessionInitProps {
    url?: string;
    tabId?: number;
    windowId?: number;
    wcTopic?: string;
    /**
     * The browser frame the dApp runs in: 0 is the tab's top frame, anything else is an iframe.
     * Only platforms that can report it from a trusted source pass it (the extension reads it
     * from `chrome.runtime.MessageSender`); it stays undefined on mobile WebViews (main-frame
     * only injection) and for WalletConnect, which has no frame at all.
     */
    frameId?: number;
    /**
     * The URL of the tab's top-level document, which differs from `url` when the dApp is embedded
     * in an iframe. Reported by the browser alongside `frameId`, so the page cannot spoof it.
     */
    topFrameUrl?: string;
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
    frameId?: number;
    /**
    @state {string} topFrameOrigin = the origin of the tab's top-level document. Equal to `origin`
    when the dApp is the top frame itself, and different when it is embedded in an iframe.
     */
    topFrameOrigin?: string;
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
    constructor({ tabId, windowId, url, wcTopic, frameId, topFrameUrl }?: SessionInitProps);
    /**
     * Refreshes where the dApp sits in the tab's frame tree. Called on every incoming request, so
     * the context is always the browser's current answer instead of a remembered one - a session
     * object outlives navigations, and a stale top frame would produce a wrong verdict.
     *
     * A platform that cannot report frame context omits `frameId` entirely and leaves the previous
     * values untouched (e.g. a WalletConnect request must not wipe the context of an injected
     * session). When `frameId` is present, `topFrameUrl` is trusted as-is, including when absent.
     */
    updateFrameContext({ frameId, topFrameUrl }: Pick<SessionInitProps, 'frameId' | 'topFrameUrl'>): void;
    setMessenger(messenger: Messenger, isAmbireNext: boolean): void;
    setProp({ icon, name }: SessionProp): void;
    get sessionId(): string;
    toJSON(): this & {
        sessionId: string;
    };
}
//# sourceMappingURL=session.d.ts.map