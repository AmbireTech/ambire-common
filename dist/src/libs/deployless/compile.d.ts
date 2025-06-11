interface Options {
    fileName?: null | string;
    contractsFolder?: null | string;
}
export declare function compile(contractName: string, options?: Options): {
    abi: any;
    bin: string;
    binRuntime: string;
};
export {};
//# sourceMappingURL=compile.d.ts.map