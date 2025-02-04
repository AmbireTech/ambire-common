import { Messenger } from '../interfaces/messenger';
export interface SessionProp {
    origin?: string;
    icon?: string;
    name?: string;
    tabId?: number;
}
export declare class Session {
    origin: string;
    icon: string;
    name: string;
    tabId: number | null;
    messenger: Messenger | null;
    sendMessage(event: any, data: any): void;
    constructor(data: SessionProp);
    setMessenger(messenger: Messenger): void;
    setProp({ origin, icon, name, tabId }: SessionProp): void;
    get sessionId(): string;
    toJSON(): this & {
        sessionId: string;
    };
}
//# sourceMappingURL=session.d.ts.map