import { HumanizerVisualization, HumanizerWarning, IrCall } from '../../interfaces';
export declare const erc20TransferFromAbi: readonly [{
    readonly name: "erc20TransferFrom";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}];
export declare const erc20TransferAbi: readonly [{
    readonly name: "erc20Transfer";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}];
export declare const nativeTransferAbi: readonly [{
    readonly name: "nativeTransfer";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "receiver";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}];
export declare const wrapNativeAbi: readonly [{
    readonly name: "wrapNative";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}];
export declare const unwrapNativeAbi: readonly [{
    readonly name: "unwrapNative";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}];
export declare const permit2TransferFromAbi: readonly [{
    readonly name: "permit2TransferFrom";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }, {
        readonly type: "uint256";
        readonly name: "amount";
    }];
    readonly outputs: readonly [];
}];
export declare const morphoSupplyCollateralAbi: readonly [{
    readonly name: "morphoSupplyCollateral";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "loanToken";
        }, {
            readonly type: "address";
            readonly name: "collateralToken";
        }, {
            readonly type: "address";
            readonly name: "oracle";
        }, {
            readonly type: "address";
            readonly name: "irm";
        }, {
            readonly type: "uint256";
            readonly name: "lltv";
        }];
        readonly name: "marketParams";
    }, {
        readonly type: "uint256";
        readonly name: "assets";
    }, {
        readonly type: "address";
        readonly name: "onBehalf";
    }, {
        readonly type: "bytes";
        readonly name: "data";
    }];
    readonly outputs: readonly [];
}];
export declare const morphoBorrowAbi: readonly [{
    readonly name: "morphoBorrow";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "loanToken";
        }, {
            readonly type: "address";
            readonly name: "collateralToken";
        }, {
            readonly type: "address";
            readonly name: "oracle";
        }, {
            readonly type: "address";
            readonly name: "irm";
        }, {
            readonly type: "uint256";
            readonly name: "lltv";
        }];
        readonly name: "marketParams";
    }, {
        readonly type: "uint256";
        readonly name: "assets";
    }, {
        readonly type: "uint256";
        readonly name: "shares";
    }, {
        readonly type: "uint256";
        readonly name: "minSharePriceE27";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }];
    readonly outputs: readonly [];
}];
export declare const morphoRepayAbi: readonly [{
    readonly name: "morphoRepay";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "loanToken";
        }, {
            readonly type: "address";
            readonly name: "collateralToken";
        }, {
            readonly type: "address";
            readonly name: "oracle";
        }, {
            readonly type: "address";
            readonly name: "irm";
        }, {
            readonly type: "uint256";
            readonly name: "lltv";
        }];
        readonly name: "marketParams";
    }, {
        readonly type: "uint256";
        readonly name: "assets";
    }, {
        readonly type: "uint256";
        readonly name: "shares";
    }, {
        readonly type: "uint256";
        readonly name: "maxSharePriceE27";
    }, {
        readonly type: "address";
        readonly name: "onBehalf";
    }, {
        readonly type: "bytes";
        readonly name: "data";
    }];
    readonly outputs: readonly [];
}];
export declare const morphoWithdrawCollateralAbi: readonly [{
    readonly name: "morphoWithdrawCollateral";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "loanToken";
        }, {
            readonly type: "address";
            readonly name: "collateralToken";
        }, {
            readonly type: "address";
            readonly name: "oracle";
        }, {
            readonly type: "address";
            readonly name: "irm";
        }, {
            readonly type: "uint256";
            readonly name: "lltv";
        }];
        readonly name: "marketParams";
    }, {
        readonly type: "uint256";
        readonly name: "assets";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }];
    readonly outputs: readonly [];
}];
export declare const morphoFlashLoanAbi: readonly [{
    readonly name: "morphoFlashLoan";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "token";
    }, {
        readonly type: "uint256";
        readonly name: "assets";
    }, {
        readonly type: "bytes";
        readonly name: "data";
    }];
    readonly outputs: readonly [];
}];
export declare const erc4626MintAbi: readonly [{
    readonly name: "erc4626Mint";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "vault";
    }, {
        readonly type: "uint256";
        readonly name: "shares";
    }, {
        readonly type: "uint256";
        readonly name: "maxSharePriceE27";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }];
    readonly outputs: readonly [];
}];
export declare const erc4626DepositAbi: readonly [{
    readonly name: "erc4626Deposit";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "vault";
    }, {
        readonly type: "uint256";
        readonly name: "assets";
    }, {
        readonly type: "uint256";
        readonly name: "maxSharePriceE27";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }];
    readonly outputs: readonly [];
}];
export declare const erc4626WithdrawAbi: readonly [{
    readonly name: "erc4626Withdraw";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "vault";
    }, {
        readonly type: "uint256";
        readonly name: "assets";
    }, {
        readonly type: "uint256";
        readonly name: "minSharePriceE27";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }, {
        readonly type: "address";
        readonly name: "owner";
    }];
    readonly outputs: readonly [];
}];
export declare const erc4626RedeemAbi: readonly [{
    readonly name: "erc4626Redeem";
    readonly type: "function";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "vault";
    }, {
        readonly type: "uint256";
        readonly name: "shares";
    }, {
        readonly type: "uint256";
        readonly name: "minSharePriceE27";
    }, {
        readonly type: "address";
        readonly name: "receiver";
    }, {
        readonly type: "address";
        readonly name: "owner";
    }];
    readonly outputs: readonly [];
}];
export declare const publicAllocatorReallocateToAbi: readonly [{
    readonly name: "reallocateTo";
    readonly type: "function";
    readonly stateMutability: "payable";
    readonly inputs: readonly [{
        readonly type: "address";
        readonly name: "vault";
    }, {
        readonly type: "tuple[]";
        readonly components: readonly [{
            readonly type: "tuple";
            readonly components: readonly [{
                readonly type: "address";
                readonly name: "loanToken";
            }, {
                readonly type: "address";
                readonly name: "collateralToken";
            }, {
                readonly type: "address";
                readonly name: "oracle";
            }, {
                readonly type: "address";
                readonly name: "irm";
            }, {
                readonly type: "uint256";
                readonly name: "lltv";
            }];
            readonly name: "marketParams";
        }, {
            readonly type: "uint128";
            readonly name: "amount";
        }];
        readonly name: "withdrawals";
    }, {
        readonly type: "tuple";
        readonly components: readonly [{
            readonly type: "address";
            readonly name: "loanToken";
        }, {
            readonly type: "address";
            readonly name: "collateralToken";
        }, {
            readonly type: "address";
            readonly name: "oracle";
        }, {
            readonly type: "address";
            readonly name: "irm";
        }, {
            readonly type: "uint256";
            readonly name: "lltv";
        }];
        readonly name: "supplyMarketParams";
    }];
    readonly outputs: readonly [];
}];
export interface BundleCall {
    to: string;
    data: string;
    value: bigint;
    skipRevert: boolean;
    callbackHash: string;
    fullVisualization?: HumanizerVisualization[];
    warnings?: HumanizerWarning[];
}
export declare const getWarnings: (accAddr: string, onBehalf: string) => HumanizerWarning[];
export declare const decodeGeneralAdapterCall: (accAddr: string, call: IrCall) => IrCall;
export declare const decodeGeneralAdapter: (accAddr: string, bundle: BundleCall[]) => IrCall[];
//# sourceMappingURL=generalAdapter.d.ts.map