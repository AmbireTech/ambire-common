/**
 *
 * @param accountAddr account address
 * @returns the state override object required for transaction simulation and estimation
 */
export declare function getEoaSimulationStateOverride(accountAddr: string): {
    [x: string]: {
        code: string;
        stateDiff: {
            [x: string]: string;
        };
    };
};
//# sourceMappingURL=simulationStateOverride.d.ts.map