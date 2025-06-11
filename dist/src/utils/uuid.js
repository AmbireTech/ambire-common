"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateUuid = void 0;
const uuid_1 = require("uuid");
/** Generates 36-character unique identifier */
const generateUuid = () => (0, uuid_1.v4)();
exports.generateUuid = generateUuid;
//# sourceMappingURL=uuid.js.map