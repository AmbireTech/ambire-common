"use strict";
/* eslint-disable class-methods-use-this */
/* eslint-disable @typescript-eslint/no-unused-vars */
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrokenPimlicoBroadcast = void 0;
const pimlico_1 = require("./pimlico");
/**
 * DANGER
 * This class is made purely for the intention of using it for tests
 * where the broadcast fails but everything else should work.
 * When broadcast fails, estimation should switch to biconomy
 * and continue on
 */
class BrokenPimlicoBroadcast extends pimlico_1.Pimlico {
    broadcast(userOperation, network) {
        throw new Error('Internal error from bundler');
    }
}
exports.BrokenPimlicoBroadcast = BrokenPimlicoBroadcast;
//# sourceMappingURL=brokenPimlicoBroadcast.js.map