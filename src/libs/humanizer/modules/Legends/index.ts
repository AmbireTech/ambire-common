import {
  decodeFunctionData,
  getAddress,
  isAddress,
  parseAbi,
  toFunctionSelector,
  zeroAddress
} from 'viem'

import { AccountOp } from '../../../accountOp/accountOp'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import {
  HexIrCall,
  getAction,
  getAddressVisualization,
  getImage,
  getLabel,
  isHexCall
} from '../../utils'

const ONCHAIN_TXNS_LEGENDS_ADDRESS = '0x1415926535897932384626433832795028841971'
const OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES = [
  '0x52d067EBB7b06F31AEB645Bd34f92c3Ac13a29ea',
  '0xcfbAec203431045E9589F70375AC5F529EE55511',
  '0xF51dF52d0a9BEeB7b6E4B6451e729108a115B863',
  '0xb850AcfBC7720873242D27A38E4AE987f914Ef5B',
  '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272'
]

// legacy mint function
const mintLegacyAbi = parseAbi(['function mint(uint256)'])
const mintAbi = parseAbi(['function mint(uint characterType, uint season)'])
const getDailyRewardAbi = parseAbi(['function getDailyReward()'])
const spinWheelAbi = parseAbi(['function spinWheel(uint256 random)'])
const linkAndAcceptInviteAbi = parseAbi([
  'function linkAndAcceptInvite(address INVITEE_V2_ACCOUNT, address INVITEE_EOA_OR_V1, address INVITER_V2, bytes signature)'
])
const inviteAbi = parseAbi(['function invite(address)'])
const claimXpFromFeedbackAbi = parseAbi(['function claimXpFromFeedback(string)'])
const claimBitrefillCodeAbi = parseAbi(['function claimBitrefillCode()'])
const revealMascotLetterAbi = parseAbi(['function revealMascotLetter()'])

const legendsModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const characterTypes: { [season: number]: string[] } = {
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
  }
  const matcher: Record<string, (call: HexIrCall) => any> = {
    // legacy mint function
    [toFunctionSelector(mintLegacyAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: mintLegacyAbi, data: call.data })
      const [heroType] = args

      return [
        getAction('Pick character'),
        getImage((characterTypes[0] ?? [])[Number(heroType)] || (characterTypes[0] ?? [])[0] || ''),
        getLabel('for Ambire Rewards')
      ]
    },
    [toFunctionSelector(mintAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: mintAbi, data: call.data })
      const [heroType, season] = args

      return [
        getAction('Pick character'),
        getImage(
          (characterTypes[Number(season)] ?? [])[Number(heroType)] ||
            (characterTypes[0] ?? [])[0] ||
            ''
        ),
        getLabel(`for Ambire Rewards season ${season}`)
      ]
    },
    [toFunctionSelector(getDailyRewardAbi[0])]: () => [getAction('Unlock the treasure chest')],
    [toFunctionSelector(spinWheelAbi[0])]: () => {
      return [getAction('Unlock the wheel of fortune')]
    },
    [toFunctionSelector(linkAndAcceptInviteAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: linkAndAcceptInviteAbi, data: call.data })
      const [inviteeV2Account, inviteeEoaOrV1, inviter] = args
      const acceptInvitationVisualizationPrefix =
        inviter !== zeroAddress
          ? [
              getAction('Accept invitation'),
              getLabel('from'),
              getAddressVisualization(inviter),
              getLabel('and')
            ]
          : []
      return [
        ...acceptInvitationVisualizationPrefix,
        getAction('Link account'),
        getAddressVisualization(inviteeEoaOrV1),
        getLabel('to'),
        getAddressVisualization(inviteeV2Account)
      ]
    },
    [toFunctionSelector(inviteAbi[0])]: (call) => {
      const { args } = decodeFunctionData({ abi: inviteAbi, data: call.data })
      const [invitee] = args

      return [getAction('Invite'), getAddressVisualization(invitee), getLabel('to Ambire Rewards')]
    },
    [toFunctionSelector(claimXpFromFeedbackAbi[0])]: () => {
      return [getAction('Claim XP'), getLabel('from'), getLabel('feedback form', true)]
    },
    [toFunctionSelector(claimBitrefillCodeAbi[0])]: () => {
      return [getAction('Claim'), getLabel('cashback code for'), getLabel('Bitrefill', true)]
    },
    [toFunctionSelector(revealMascotLetterAbi[0])]: () => {
      return [getAction('Reveal'), getLabel('a letter from'), getLabel('SHI_T_', true)]
    }
  }
  const newCalls = calls.map((call) => {
    if (
      (call.to &&
        isAddress(call.to) &&
        ![ONCHAIN_TXNS_LEGENDS_ADDRESS, ...OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES].includes(
          getAddress(call.to)
        )) ||
      !isHexCall(call) ||
      !matcher[call.data.slice(0, 10)]
    )
      return call
    const match = matcher[call.data.slice(0, 10)]
    if (!match) return call
    return { ...call, fullVisualization: match(call) }
  })

  return newCalls
}

export default legendsModule
