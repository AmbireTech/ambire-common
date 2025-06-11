"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = isDKIM;
function isDKIM(key) {
    return /^(DKIM-Signature|X-Google-DKIM-Signature)/.test(key);
}
//# sourceMappingURL=isDKIM.js.map