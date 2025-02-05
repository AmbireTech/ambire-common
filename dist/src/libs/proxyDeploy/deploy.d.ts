export declare function privSlot(slotNumber: any, keyType: any, key: any, valueType: any): any;
export interface PrivLevels {
    addr: string;
    hash: string;
}
export declare function getProxyDeployBytecode(masterContractAddr: string, privLevels: PrivLevels[], opts?: {
    privSlot: number;
}): string;
export declare function getStorageSlotsFromArtifact(buildInfo: any): {
    privSlot: any;
};
//# sourceMappingURL=deploy.d.ts.map