"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignAccountOpTesterController = void 0;
const signAccountOp_1 = require("./signAccountOp");
class SignAccountOpTesterController extends signAccountOp_1.SignAccountOpController {
    constructor(accounts, networks, keystore, portfolio, externalSignerControllers, account, network, provider, fromActionId, accountOp, isSignRequestStillActive, shouldSimulate, traceCall, estimateController, gasPriceController) {
        super(accounts, networks, keystore, portfolio, externalSignerControllers, account, network, provider, fromActionId, accountOp, isSignRequestStillActive, shouldSimulate, traceCall);
        // remove main handlers
        this.estimation.onUpdate(() => { });
        this.gasPrice.onUpdate(() => { });
        // assign easy to mock controllers
        this.estimation = estimateController;
        this.gasPrice = gasPriceController;
    }
}
exports.SignAccountOpTesterController = SignAccountOpTesterController;
//# sourceMappingURL=signAccountOpTester.js.map