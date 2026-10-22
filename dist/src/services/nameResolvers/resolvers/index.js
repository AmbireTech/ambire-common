"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_RESOLVERS = void 0;
const tslib_1 = require("tslib");
const EnsResolver_1 = require("./EnsResolver");
const GnsResolver_1 = require("./GnsResolver");
const NamoshiResolver_1 = require("./NamoshiResolver");
tslib_1.__exportStar(require("./EnsCompatibleResolver"), exports);
tslib_1.__exportStar(require("./EnsResolver"), exports);
tslib_1.__exportStar(require("./NamoshiResolver"), exports);
tslib_1.__exportStar(require("./GnsResolver"), exports);
/**
 * All name services the wallet resolves, in display-priority order (first match wins when an address
 * has names in several services). ENS is the fallback and the current primary.
 */
exports.DEFAULT_RESOLVERS = [
    new EnsResolver_1.EnsResolver(),
    new NamoshiResolver_1.NamoshiResolver(),
    new GnsResolver_1.GnsResolver()
];
//# sourceMappingURL=index.js.map