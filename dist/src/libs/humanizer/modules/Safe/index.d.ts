import { HumanizerCallModule, HumanizerVisualization, HumanizerWarning } from '../../interfaces';
export declare const shouldDisplaySafeDelegateCallWarning: (operation: bigint | number, to?: string) => boolean;
export declare const getDelegateCallWarning: (operation: bigint | number, to?: string) => HumanizerWarning[];
export declare const getSafeHumanization: (safeAddr?: string, to?: string, value?: string | number | bigint, data?: string, setupHookDepth?: number, nonce?: string | number | bigint | null) => {
    visuals?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
} | undefined;
declare const SafeModule: HumanizerCallModule;
export default SafeModule;
//# sourceMappingURL=index.d.ts.map