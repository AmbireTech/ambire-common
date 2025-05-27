import { Mnemonic } from 'ethers';
export declare class EntropyGenerator {
    #private;
    generateRandomBytes(length: number, extraEntropy: string): Uint8Array;
    generateRandomMnemonic(wordCount: 12 | 24, extraEntropy: string): Mnemonic;
    addEntropy(newEntropy: Uint8Array): void;
}
//# sourceMappingURL=entropyGenerator.d.ts.map