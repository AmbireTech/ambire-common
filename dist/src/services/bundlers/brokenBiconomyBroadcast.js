"use strict";
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrokenBiconomyBroadcast = void 0;
const biconomy_1 = require("./biconomy");
/**
 * DANGER
 * This class is made purely for the intention of using it for tests
 * where the broadcast fails but everything else should work.
 * When broadcast fails, estimation should switch to pimlico
 * and continue on
 */
class BrokenBiconomyBroadcast extends biconomy_1.Biconomy {
    broadcast(userOperation, network) {
        throw new Error('Internal error from bundler');
    }
}
exports.BrokenBiconomyBroadcast = BrokenBiconomyBroadcast;
//# sourceMappingURL=brokenBiconomyBroadcast.js.map