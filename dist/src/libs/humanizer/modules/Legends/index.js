"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const ethers_1 = require("ethers");
const Legends_1 = require("../../const/abis/Legends");
const utils_1 = require("../../utils");
const ONCHAIN_TXNS_LEGENDS_ADDRESS = '0x1415926535897932384626433832795028841971';
const OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES = [
    '0x52d067EBB7b06F31AEB645Bd34f92c3Ac13a29ea',
    '0xcfbAec203431045E9589F70375AC5F529EE55511',
    '0xF51dF52d0a9BEeB7b6E4B6451e729108a115B863',
    '0xb850AcfBC7720873242D27A38E4AE987f914Ef5B'
];
const legendsModule = (accOp, calls) => {
    const iface = new ethers_1.Interface(Legends_1.Legends);
    const characterTypes = [
        {
            type: 'Unknown',
            image: 'https://relayer.ambire.com/legends/nft-image/avatar/unknown.png'
        },
        {
            type: 'The Degenerate',
            image: 'https://relayer.ambire.com/legends/nft-image/avatar/slime-lvl0.png'
        },
        {
            type: 'The Codeweaver',
            image: 'https://relayer.ambire.com/legends/nft-image/avatar/sorceress-lvl0.png'
        },
        {
            type: 'The Layerbinder',
            image: 'https://relayer.ambire.com/legends/nft-image/avatar/necromancer-lvl0.png'
        },
        {
            type: 'The Custodian',
            image: 'https://relayer.ambire.com/legends/nft-image/avatar/penguin-lvl0.png'
        },
        {
            type: 'The Warrior',
            image: 'https://relayer.ambire.com/legends/nft-image/avatar/orc-lvl0.png'
        },
        {
            type: 'The Shapeshifter',
            image: 'https://relayer.ambire.com/legends/nft-image/avatar/shapeshifter-lvl0.png'
        }
    ];
    const matcher = {
        [iface.getFunction('mint')?.selector]: (call) => {
            const [heroType] = iface.parseTransaction(call).args;
            return [
                (0, utils_1.getAction)('Pick character'),
                (0, utils_1.getImage)(characterTypes[heroType]?.image || characterTypes[0].image),
                (0, utils_1.getLabel)(characterTypes[heroType]?.type || characterTypes[0].type, true),
                (0, utils_1.getLabel)('for Ambire Legends')
            ];
        },
        [iface.getFunction('getDailyReward')?.selector]: () => [
            (0, utils_1.getAction)('Unlock the treasure chest')
        ],
        [iface.getFunction('spinWheel')?.selector]: () => {
            return [(0, utils_1.getAction)('Unlock the wheel of fortune')];
        },
        [iface.getFunction('linkAndAcceptInvite')?.selector]: (call) => {
            const [inviteeV2Account, inviteeEoaOrV1, inviter] = iface.parseTransaction(call).args;
            const acceptInvitationVisualizationPrefix = inviter !== ethers_1.ZeroAddress
                ? [
                    (0, utils_1.getAction)('Accept invitation'),
                    (0, utils_1.getLabel)('from'),
                    (0, utils_1.getAddressVisualization)(inviter),
                    (0, utils_1.getLabel)('and')
                ]
                : [];
            return [
                ...acceptInvitationVisualizationPrefix,
                (0, utils_1.getAction)('Link account'),
                (0, utils_1.getAddressVisualization)(inviteeEoaOrV1),
                (0, utils_1.getLabel)('to'),
                (0, utils_1.getAddressVisualization)(inviteeV2Account)
            ];
        },
        [iface.getFunction('invite')?.selector]: (call) => {
            const [invitee] = iface.parseTransaction(call).args;
            return [(0, utils_1.getAction)('Invite'), (0, utils_1.getAddressVisualization)(invitee), (0, utils_1.getLabel)('to Ambire Legends')];
        },
        [iface.getFunction('claimXpFromFeedback')?.selector]: () => {
            return [(0, utils_1.getAction)('Claim XP'), (0, utils_1.getLabel)('from'), (0, utils_1.getLabel)('feedback form', true)];
        }
    };
    const newCalls = calls.map((call) => {
        if (![ONCHAIN_TXNS_LEGENDS_ADDRESS, ...OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES].includes((0, ethers_1.getAddress)(call.to)) ||
            !matcher[call.data.slice(0, 10)])
            return call;
        return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) };
    });
    return newCalls;
};
exports.default = legendsModule;
//# sourceMappingURL=index.js.map