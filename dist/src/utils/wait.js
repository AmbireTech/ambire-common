"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/* eslint-disable no-promise-executor-return */
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.default = wait;
//# sourceMappingURL=wait.js.map