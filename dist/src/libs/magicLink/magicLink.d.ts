import { MagicLinkFlow } from '../../interfaces/emailVault';
import { Fetch } from '../../interfaces/fetch';
export interface MagicLinkData {
    key: string;
    secret?: String;
    expiry: number;
}
export interface RequestMagicLinkResult {
    success: Boolean;
    data: MagicLinkData;
    message: String;
}
export declare function requestMagicLink(email: String, relayerUrl: String, fetch: Fetch, options?: {
    autoConfirm?: boolean;
    flow?: MagicLinkFlow;
}): Promise<MagicLinkData>;
//# sourceMappingURL=magicLink.d.ts.map