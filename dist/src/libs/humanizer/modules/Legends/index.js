"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const viem_1 = require("viem");
const utils_1 = require("../../utils");
const ONCHAIN_TXNS_LEGENDS_ADDRESS = '0x1415926535897932384626433832795028841971';
const OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES = [
    '0x52d067EBB7b06F31AEB645Bd34f92c3Ac13a29ea',
    '0xcfbAec203431045E9589F70375AC5F529EE55511',
    '0xF51dF52d0a9BEeB7b6E4B6451e729108a115B863',
    '0xb850AcfBC7720873242D27A38E4AE987f914Ef5B',
    '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272'
];
// legacy mint function
const mintLegacyAbi = (0, viem_1.parseAbi)(['function mint(uint256)']);
const mintAbi = (0, viem_1.parseAbi)(['function mint(uint characterType, uint season)']);
const getDailyRewardAbi = (0, viem_1.parseAbi)(['function getDailyReward()']);
const spinWheelAbi = (0, viem_1.parseAbi)(['function spinWheel(uint256 random)']);
const linkAndAcceptInviteAbi = (0, viem_1.parseAbi)([
    'function linkAndAcceptInvite(address INVITEE_V2_ACCOUNT, address INVITEE_EOA_OR_V1, address INVITER_V2, bytes signature)'
]);
const inviteAbi = (0, viem_1.parseAbi)(['function invite(address)']);
const claimXpFromFeedbackAbi = (0, viem_1.parseAbi)(['function claimXpFromFeedback(string)']);
const claimBitrefillCodeAbi = (0, viem_1.parseAbi)(['function claimBitrefillCode()']);
const revealMascotLetterAbi = (0, viem_1.parseAbi)(['function revealMascotLetter()']);
const mintLegacySelector = (0, viem_1.toFunctionSelector)(mintLegacyAbi[0]);
const mintSelector = (0, viem_1.toFunctionSelector)(mintAbi[0]);
const getDailyRewardSelector = (0, viem_1.toFunctionSelector)(getDailyRewardAbi[0]);
const spinWheelSelector = (0, viem_1.toFunctionSelector)(spinWheelAbi[0]);
const linkAndAcceptInviteSelector = (0, viem_1.toFunctionSelector)(linkAndAcceptInviteAbi[0]);
const inviteSelector = (0, viem_1.toFunctionSelector)(inviteAbi[0]);
const claimXpFromFeedbackSelector = (0, viem_1.toFunctionSelector)(claimXpFromFeedbackAbi[0]);
const claimBitrefillCodeSelector = (0, viem_1.toFunctionSelector)(claimBitrefillCodeAbi[0]);
const revealMascotLetterSelector = (0, viem_1.toFunctionSelector)(revealMascotLetterAbi[0]);
const legendsModule = (accOp, call) => {
    const characterTypes = {
        '0': [
            'https://relayer.ambire.com/legends/nft-image/avatar/unknown.png',
            'https://relayer.ambire.com/legends/nft-image/avatar/slime-lvl0.png',
            'https://relayer.ambire.com/legends/nft-image/avatar/sorceress-lvl0.png',
            'https://relayer.ambire.com/legends/nft-image/avatar/necromancer-lvl0.png',
            'https://relayer.ambire.com/legends/nft-image/avatar/penguin-lvl0.png',
            'https://relayer.ambire.com/legends/nft-image/avatar/orc-lvl0.png',
            'https://relayer.ambire.com/legends/nft-image/avatar/shapeshifter-lvl0.png'
        ],
        '1': [
            'https://relayer.ambire.com/legends/nft-image/avatar/unknown.png',
            'https://staging-relayer.ambire.com/legends/nft-image/avatar/astro-cat-lvl0.png',
            'https://staging-relayer.ambire.com/legends/nft-image/avatar/medal-bear-lvl0.png',
            'https://staging-relayer.ambire.com/legends/nft-image/avatar/yellow-blue-lvl0.png',
            'https://staging-relayer.ambire.com/legends/nft-image/avatar/black-lvl0.png',
            'https://staging-relayer.ambire.com/legends/nft-image/avatar/green-lvl0.png'
        ]
    };
    const matcher = {
        // legacy mint function
        [mintLegacySelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: mintLegacyAbi, data: call.data });
            const [heroType] = args;
            return [
                (0, utils_1.getAction)('Pick character'),
                (0, utils_1.getImage)((characterTypes[0] ?? [])[Number(heroType)] || (characterTypes[0] ?? [])[0] || ''),
                (0, utils_1.getLabel)('for Ambire Rewards')
            ];
        },
        [mintSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: mintAbi, data: call.data });
            const [heroType, season] = args;
            return [
                (0, utils_1.getAction)('Pick character'),
                (0, utils_1.getImage)((characterTypes[Number(season)] ?? [])[Number(heroType)] ||
                    (characterTypes[0] ?? [])[0] ||
                    ''),
                (0, utils_1.getLabel)(`for Ambire Rewards season ${season}`)
            ];
        },
        [getDailyRewardSelector]: () => [(0, utils_1.getAction)('Unlock the treasure chest')],
        [spinWheelSelector]: () => {
            return [(0, utils_1.getAction)('Unlock the wheel of fortune')];
        },
        [linkAndAcceptInviteSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: linkAndAcceptInviteAbi, data: call.data });
            const [inviteeV2Account, inviteeEoaOrV1, inviter] = args;
            const acceptInvitationVisualizationPrefix = inviter !== viem_1.zeroAddress
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
        [inviteSelector]: (call) => {
            const { args } = (0, viem_1.decodeFunctionData)({ abi: inviteAbi, data: call.data });
            const [invitee] = args;
            return [(0, utils_1.getAction)('Invite'), (0, utils_1.getAddressVisualization)(invitee), (0, utils_1.getLabel)('to Ambire Rewards')];
        },
        [claimXpFromFeedbackSelector]: () => {
            return [(0, utils_1.getAction)('Claim XP'), (0, utils_1.getLabel)('from'), (0, utils_1.getLabel)('feedback form', true)];
        },
        [claimBitrefillCodeSelector]: () => {
            return [(0, utils_1.getAction)('Claim'), (0, utils_1.getLabel)('cashback code for'), (0, utils_1.getLabel)('Bitrefill', true)];
        },
        [revealMascotLetterSelector]: () => {
            return [(0, utils_1.getAction)('Reveal'), (0, utils_1.getLabel)('a letter from'), (0, utils_1.getLabel)('SHI_T_', true)];
        }
    };
    if ((call.to &&
        (0, viem_1.isAddress)(call.to) &&
        ![ONCHAIN_TXNS_LEGENDS_ADDRESS, ...OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES].includes((0, viem_1.getAddress)(call.to))) ||
        !(0, utils_1.isHexCall)(call))
        return call;
    const match = matcher[call.data.slice(0, 10)];
    if (!match)
        return call;
    return { ...call, fullVisualization: match(call) };
};
exports.default = legendsModule;
//# sourceMappingURL=index.js.map