export type PortfolioDebugFlow = 'update' | 'discovery' | 'simulation' | 'defi' | 'learning' | 'hints' | 'blacklist';
export declare const portfolioDebugLog: (flow: PortfolioDebugFlow, message: string, payload?: unknown | (() => unknown), options?: import("../debugLogger/debugLogger").DebugLogOptions) => void;
//# sourceMappingURL=debug.d.ts.map