export const preProcessHumanizer = (_, currentIrCalls) => {
    const newCalls = currentIrCalls.map((_call) => {
        const call = { ..._call };
        if (!call.data) {
            call.data = '0x';
        }
        return call;
    });
    return newCalls;
};
//# sourceMappingURL=preProcessModule.js.map