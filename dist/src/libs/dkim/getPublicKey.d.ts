export default function getPublicKey({ domain, selector }: any): any;
/**
 * A wrapper to help getPublicKey reverts when a pub key is not found.
 * We don't want that
 *
 * @param {domain: string, selector: string}
 * @returns base64encoded | null
 */
export declare function getPublicKeyIfAny({ domain, selector }: any): Promise<any>;
//# sourceMappingURL=getPublicKey.d.ts.map