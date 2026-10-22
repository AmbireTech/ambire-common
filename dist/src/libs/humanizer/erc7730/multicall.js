"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MULTICALL_DESCRIPTOR = exports.MULTICALL_SELECTOR = void 0;
exports.MULTICALL_SELECTOR = '0xac9650d8';
exports.MULTICALL_DESCRIPTOR = {
    path: 'built-in/multicall',
    descriptor: {
        display: {
            formats: {
                'multicall(bytes[] data)': {
                    intent: 'Multicall',
                    fields: [
                        {
                            path: '#.data.[]',
                            label: 'Call',
                            format: 'calldata',
                            params: { calleePath: '@.to' },
                            visible: 'always'
                        }
                    ]
                }
            }
        }
    }
};
//# sourceMappingURL=multicall.js.map