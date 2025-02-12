"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
function isDKIM(key) {
    return /^(DKIM-Signature|X-Google-DKIM-Signature)/.test(key);
}
exports.default = isDKIM;
//# sourceMappingURL=isDKIM.js.map