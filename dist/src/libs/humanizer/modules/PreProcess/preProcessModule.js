"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.preProcessHumanizer = void 0;
const preProcessHumanizer = (_, _call) => {
    const call = { ..._call };
    if (!call.data) {
        call.data = '0x';
    }
    return call;
};
exports.preProcessHumanizer = preProcessHumanizer;
//# sourceMappingURL=preProcessModule.js.map