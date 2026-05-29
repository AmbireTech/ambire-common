import { SignAccountOpController } from './signAccountOp';
export class SignAccountOpTesterController extends SignAccountOpController {
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
//# sourceMappingURL=signAccountOpTester.js.map