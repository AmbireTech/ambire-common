export declare const COMMANDS: {
    FLAG_ALLOW_REVERT: string;
    COMMAND_TYPE_MASK: string;
    V3_SWAP_EXACT_IN: string;
    V3_SWAP_EXACT_OUT: string;
    PERMIT2_TRANSFER_FROM: string;
    SWEEP: string;
    TRANSFER: string;
    PAY_PORTION: string;
    V2_SWAP_EXACT_IN: string;
    V2_SWAP_EXACT_OUT: string;
    PERMIT2_PERMIT: string;
    WRAP_ETH: string;
    UNWRAP_WETH: string;
    V4_SWAP: string;
};
/**
 * ABI-like structure for each uniswap action
 * https://docs.uniswap.org/contracts/universal-router/technical-reference
 */
export declare const COMMANDS_DESCRIPTIONS: {
    V3_SWAP_EXACT_IN: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    V3_SWAP_EXACT_OUT: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    PERMIT2_TRANSFER_FROM: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    SWEEP: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    TRANSFER: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    PAY_PORTION: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    V2_SWAP_EXACT_IN: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    V2_SWAP_EXACT_OUT: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    PERMIT2_PERMIT: {
        command: string;
        inputsDetails: {
            name: string;
            type: string;
        }[];
    };
    WRAP_ETH: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    UNWRAP_WETH: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
    V4_SWAP: {
        command: string;
        inputsDetails: {
            type: string;
            name: string;
        }[];
    };
};
declare enum Subparser {
    V4SwapExactInSingle = 0,
    V4SwapExactIn = 1,
    V4SwapExactOutSingle = 2,
    V4SwapExactOut = 3,
    PoolKey = 4
}
export declare const V4_ACTION_CODES: {
    INCREASE_LIQUIDITY: string;
    DECREASE_LIQUIDITY: string;
    MINT_POSITION: string;
    BURN_POSITION: string;
    SWAP_EXACT_IN_SINGLE: string;
    SWAP_EXACT_IN: string;
    SWAP_EXACT_OUT_SINGLE: string;
    SWAP_EXACT_OUT: string;
    SETTLE: string;
    SETTLE_ALL: string;
    SETTLE_PAIR: string;
    TAKE: string;
    TAKE_ALL: string;
    TAKE_PORTION: string;
    TAKE_PAIR: string;
    CLOSE_CURRENCY: string;
    SWEEP: string;
};
export declare const V4_ACTION_DESCRIPTORS: {
    INCREASE_LIQUIDITY: {
        name: string;
        type: string;
    }[];
    DECREASE_LIQUIDITY: {
        name: string;
        type: string;
    }[];
    BURN_POSITION: {
        name: string;
        type: string;
    }[];
    SWAP_EXACT_IN_SINGLE: {
        name: string;
        type: string;
        subparser: Subparser;
    }[];
    SWAP_EXACT_IN: {
        name: string;
        type: string;
        subparser: Subparser;
    }[];
    SWAP_EXACT_OUT_SINGLE: {
        name: string;
        type: string;
        subparser: Subparser;
    }[];
    SWAP_EXACT_OUT: {
        name: string;
        type: string;
        subparser: Subparser;
    }[];
    SETTLE: {
        name: string;
        type: string;
    }[];
    SETTLE_ALL: {
        name: string;
        type: string;
    }[];
    SETTLE_PAIR: {
        name: string;
        type: string;
    }[];
    TAKE: {
        name: string;
        type: string;
    }[];
    TAKE_ALL: {
        name: string;
        type: string;
    }[];
    TAKE_PORTION: {
        name: string;
        type: string;
    }[];
    TAKE_PAIR: {
        name: string;
        type: string;
    }[];
    CLOSE_CURRENCY: {
        name: string;
        type: string;
    }[];
    SWEEP: {
        name: string;
        type: string;
    }[];
};
export {};
//# sourceMappingURL=Commands.d.ts.map