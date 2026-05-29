import { MagicLinkFlow } from '../../interfaces/emailVault';
import { Fetch } from '../../interfaces/fetch';
export interface MagicLinkData {
    key: string;
    secret?: string;
    expiry: number;
}
export interface RequestMagicLinkResult {
    success: boolean;
    data: MagicLinkData;
    message: string;
}
export declare function requestMagicLink(email: string, relayerUrl: string, fetch: Fetch, options?: {
    autoConfirm?: boolean;
    flow?: MagicLinkFlow;
}): Promise<MagicLinkData>;
//# sourceMappingURL=magicLink.d.ts.map