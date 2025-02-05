"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.openseaMessageModule = void 0;
const ethers_1 = require("ethers");
const utils_1 = require("../utils");
const SEAPORT_ADDRESS = [
    '0x0000000000000068F116a894984e2DB1123eB395',
    '0x00000000000000ADc04C56Bf30aC9d3c0aAF14dC',
    '0x00000000006c3852cbEf3e08E8dF289169EdE581',
    '0x00000000F9490004C11Cef243f5400493c00Ad63',
    '0x00e5F120f500006757E984F1DED400fc00370000',
    '0x0000f00000627D293Ab4Dfb40082001724dB006F'
];
const openseaMessageModule = (message) => {
    if (message.content.kind === 'message' && typeof message.content.message === 'string') {
        let messageAsText = message.content.message;
        if ((0, ethers_1.isHexString)(message.content.message) && message.content.message.length % 2 === 0) {
            messageAsText = (0, ethers_1.toUtf8String)(message.content.message);
        }
        const OPENSEA_LOGIN_MESSAGE_PREFIX = 'Welcome to OpenSea!';
        if (messageAsText.includes(OPENSEA_LOGIN_MESSAGE_PREFIX) &&
            messageAsText.toLowerCase().includes(message.accountAddr.toLowerCase())) {
            return {
                fullVisualization: [(0, utils_1.getAction)('Log in'), (0, utils_1.getLabel)('OpenSea', true)]
            };
        }
        const OPENSEA_PRO_LOGIN_MESSAGE_PREFIX = 'Sign in to OpenSea Pro';
        if (messageAsText.includes(OPENSEA_PRO_LOGIN_MESSAGE_PREFIX) &&
            messageAsText.toLowerCase().includes(message.accountAddr.toLowerCase())) {
            return {
                fullVisualization: [(0, utils_1.getAction)('Log in'), (0, utils_1.getLabel)('OpenSea Pro', true)]
            };
        }
    }
    if (message.content.kind === 'typedMessage') {
        if (message.content.domain.name === 'Seaport' &&
            message.content.domain.version === '1.6' &&
            SEAPORT_ADDRESS.includes(message.content.domain.verifyingContract || '')) {
            const considerations = message.content.message.consideration;
            const offer = message.content.message.offer;
            const extractItems = ({ itemType, token, identifierOrCriteria, startAmount }) => {
                if (itemType === '0')
                    return { address: token, amountOrId: BigInt(startAmount) };
                if (itemType === '1')
                    return { address: token, amountOrId: BigInt(startAmount) };
                if (itemType === '2')
                    return { address: token, amountOrId: BigInt(identifierOrCriteria) };
                if (itemType === '3')
                    return { address: token, amountOrId: BigInt(identifierOrCriteria) };
                return null;
            };
            const itemsToList = offer.map(extractItems).filter((x) => x);
            const itemsToGet = considerations
                .filter(({ recipient }) => recipient === message.accountAddr)
                .map(extractItems)
                .filter((x) => x);
            return {
                fullVisualization: [
                    (0, utils_1.getAction)('Make offer to swap'),
                    ...itemsToList.map(({ address, amountOrId }) => (0, utils_1.getToken)(address, amountOrId)),
                    (0, utils_1.getLabel)('for'),
                    ...itemsToGet.map(({ address, amountOrId }) => (0, utils_1.getToken)(address, amountOrId))
                ]
            };
        }
    }
    return { fullVisualization: [] };
};
exports.openseaMessageModule = openseaMessageModule;
//# sourceMappingURL=openseaModule.js.map