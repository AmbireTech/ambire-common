"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIsViewOnly = void 0;
const getIsViewOnly = (keys, accountKeys) => {
    return keys.every((k) => !accountKeys.includes(k.addr));
};
exports.getIsViewOnly = getIsViewOnly;
//# sourceMappingURL=accounts.js.map