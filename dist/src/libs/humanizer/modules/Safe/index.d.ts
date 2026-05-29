import { HumanizerCallModule, HumanizerVisualization, HumanizerWarning } from '../../interfaces';
export declare const getDelegateCallWarning: (operation: bigint, to?: string) => HumanizerWarning[];
export declare const getSafeHumanization: (safeAddr?: string, to?: string, value?: string | number | bigint, data?: string) => {
    visuals?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
} | undefined;
declare const SafeModule: HumanizerCallModule;
export default SafeModule;
//# sourceMappingURL=index.d.ts.map