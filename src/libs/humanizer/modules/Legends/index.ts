import { getAddress, Interface, isAddress, ZeroAddress } from 'ethers'

import { AccountOp } from '../../../accountOp/accountOp'
import { Legends } from '../../const/abis/Legends'
import { HumanizerCallModule, IrCall } from '../../interfaces'
import { getAction, getAddressVisualization, getImage, getLabel } from '../../utils'

const ONCHAIN_TXNS_LEGENDS_ADDRESS = '0x1415926535897932384626433832795028841971'
const OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES = [
  '0x52d067EBB7b06F31AEB645Bd34f92c3Ac13a29ea',
  '0xcfbAec203431045E9589F70375AC5F529EE55511',
  '0xF51dF52d0a9BEeB7b6E4B6451e729108a115B863',
  '0xb850AcfBC7720873242D27A38E4AE987f914Ef5B',
  '0x35bAc15f98Fa2F496FCb84e269d8d0a408442272'
]

const legendsModule: HumanizerCallModule = (accOp: AccountOp, calls: IrCall[]) => {
  const iface = new Interface(Legends)
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
  const matcher = {
    // legacy mint function
    [iface.getFunction('mint(uint256)')?.selector!]: (call: IrCall) => {
      const [heroType] = iface.parseTransaction(call)!.args

      return [
        getAction('Pick character'),
        getImage(characterTypes[0][heroType] || characterTypes[0][0]),
        getLabel('for Ambire Rewards')
      ]
    },
    [iface.getFunction('mint(uint characterType, uint season)')?.selector!]: (call: IrCall) => {
      const [heroType, season] = iface.parseTransaction(call)!.args

      return [
        getAction('Pick character'),
        getImage(characterTypes[season][heroType] || characterTypes[0][0]),
        getLabel(`for Ambire Rewards season ${season}`)
      ]
    },
    [iface.getFunction('getDailyReward')?.selector!]: () => [
      getAction('Unlock the treasure chest')
    ],
    [iface.getFunction('spinWheel')?.selector!]: () => {
      return [getAction('Unlock the wheel of fortune')]
    },
    [iface.getFunction('linkAndAcceptInvite')?.selector!]: (call: IrCall) => {
      const [inviteeV2Account, inviteeEoaOrV1, inviter] = iface.parseTransaction(call)!.args
      const acceptInvitationVisualizationPrefix =
        inviter !== ZeroAddress
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
    [iface.getFunction('invite')?.selector!]: (call: IrCall) => {
      const [invitee] = iface.parseTransaction(call)!.args

      return [getAction('Invite'), getAddressVisualization(invitee), getLabel('to Ambire Rewards')]
    },
    [iface.getFunction('claimXpFromFeedback')?.selector!]: () => {
      return [getAction('Claim XP'), getLabel('from'), getLabel('feedback form', true)]
    }
  }
  const newCalls = calls.map((call) => {
    if (
      (call.to &&
        isAddress(call.to) &&
        ![ONCHAIN_TXNS_LEGENDS_ADDRESS, ...OLD_AND_CURRENT_LEGENDS_NFT_ADDRESSES].includes(
          getAddress(call.to)
        )) ||
      !matcher[call.data.slice(0, 10)]
    )
      return call
    return { ...call, fullVisualization: matcher[call.data.slice(0, 10)](call) }
  })

  return newCalls
}

export default legendsModule
