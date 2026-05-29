"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignAccountOpTesterController = void 0;
const signAccountOp_1 = require("./signAccountOp");
class SignAccountOpTesterController extends signAccountOp_1.SignAccountOpController {
    constructor(props) {
        super(props);
        // remove main handlers
        this.estimation.onUpdate(() => { });
        this.gasPrice.onUpdate(() => { });
        // assign easy to mock controllers
        this.estimation = props.estimateController;
        this.gasPrice = props.gasPriceController;
    }
}
exports.SignAccountOpTesterController = SignAccountOpTesterController;
//# sourceMappingURL=signAccountOpTester.js.map