"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SignAccountOpTesterController = void 0;
const signAccountOp_1 = require("./signAccountOp");
class SignAccountOpTesterController extends signAccountOp_1.SignAccountOpController {
    /**
     * The gas price controller built by the parent constructor. The parent attaches its
     * gas price update handler to it before the mocked one is swapped in below
     */
    #ownGasPriceController;
    constructor(props) {
        super(props);
        // remove main handlers
        this.estimation.onUpdate(() => { });
        this.gasPrice.onUpdate(() => { });
        // assign easy to mock controllers
        this.#ownGasPriceController = this.gasPrice;
        this.estimation = props.estimateController;
        this.gasPrice = props.gasPriceController;
    }
    /**
     * Runs the parent's gas price update handler, as a gas price fetch would.
     * The handler reads the gas prices from the swapped in (mocked) gasPrice controller
     */
    async emitGasPriceUpdate() {
        await this.#ownGasPriceController.forceEmitUpdate();
    }
}
exports.SignAccountOpTesterController = SignAccountOpTesterController;
//# sourceMappingURL=signAccountOpTester.js.map