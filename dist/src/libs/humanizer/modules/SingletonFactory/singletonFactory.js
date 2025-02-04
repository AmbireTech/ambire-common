import { getAddress, Interface } from 'ethers';
import { getAction, getAddressVisualization, getLabel } from '../../utils';
const CONTRACT_FACTORY_ADDRESS = '0xce0042B868300000d44A59004Da54A005ffdcf9f';
export const singletonFactory = (_, irCalls) => {
    const iface = new Interface(['function  deploy(bytes,bytes32)']);
    const newCalls = irCalls.map((call) => {
        // @TODO fix those upper/lowercase
        if (getAddress(call.to) === CONTRACT_FACTORY_ADDRESS &&
            call.data.slice(0, 10) === iface.getFunction('deploy').selector) {
            return {
                ...call,
                fullVisualization: [
                    getAction('Deploy a contract'),
                    getLabel('via'),
                    getAddressVisualization(CONTRACT_FACTORY_ADDRESS)
                ]
            };
        }
        return call;
    });
    return newCalls;
};
//# sourceMappingURL=singletonFactory.js.map