type TransferLog = {
    address: string;
    topics: readonly string[];
    data: string;
};
export type TransferLogNft = {
    address: string;
    tokenId: bigint;
    balanceChange: bigint;
};
export declare function getTransferLogTokens(logs: readonly TransferLog[], accountAddr: string): Promise<string[]>;
/**
 * Returns the ERC-721 balance changes involving the account. ERC-721 Transfer
 * logs have the token ID in a fourth topic, unlike ERC-20 Transfer logs where
 * the amount is stored in the log data.
 */
export declare function getTransferLogNfts(logs: readonly TransferLog[], accountAddr: string): Promise<TransferLogNft[]>;
export {};
//# sourceMappingURL=parseLogs.d.ts.map