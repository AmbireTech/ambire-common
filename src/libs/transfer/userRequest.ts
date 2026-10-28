import { Interface, isAddress, parseUnits } from 'ethers'
import { v4 as uuidv4 } from 'uuid'

import { Call } from '@/libs/accountOp/types'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import IERC721 from '../../../contracts/compiled/IERC721.json'
import WALLETSupplyControllerABI from '../../../contracts/compiled/WALLETSupplyController.json'
import WETH from '../../../contracts/compiled/WETH.json'
import { FEE_COLLECTOR, STK_WALLET, SUPPLY_CONTROLLER_ADDR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { TransferNft } from '../../interfaces/transfer'
import { CallsUserRequest } from '../../interfaces/userRequest'
import { PaymasterService } from '../erc7677/types'
import { AddrVestingData, ClaimableRewardsData, TokenResult } from '../portfolio'
import { getSanitizedAmount } from './amount'

const ERC20 = new Interface(IERC20.abi)
const ERC721 = new Interface(IERC721.abi)
const supplyControllerInterface = new Interface(WALLETSupplyControllerABI)

interface BuildUserRequestParams {
  amount: string
  selectedToken: TokenResult
  selectedAccount: string
  recipientAddress: string
  recipientDomain: string | undefined
  paymasterService?: PaymasterService
  windowId?: number
  amountInFiat?: bigint
}

function getMintVestingRequestParams({
  selectedAccount,
  selectedToken,
  addrVestingData
}: {
  selectedAccount: string
  selectedToken: TokenResult
  addrVestingData: AddrVestingData
}): {
  calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
  meta: CallsUserRequest['meta']
} {
  return {
    calls: [
      {
        to: SUPPLY_CONTROLLER_ADDR,
        value: BigInt(0),
        data: supplyControllerInterface.encodeFunctionData('mintVesting', [
          addrVestingData?.addr,
          addrVestingData?.end,
          addrVestingData?.rate
        ])
      }
    ],
    meta: {
      chainId: selectedToken.chainId,
      accountAddr: selectedAccount
    }
  }
}

function getClaimWalletRequestParams({
  selectedAccount,
  selectedToken,
  claimableRewardsData
}: {
  selectedAccount: string
  selectedToken: TokenResult
  claimableRewardsData: ClaimableRewardsData
}): {
  calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
  meta: CallsUserRequest['meta']
} {
  return {
    calls: [
      {
        to: SUPPLY_CONTROLLER_ADDR,
        value: BigInt(0),
        data: supplyControllerInterface.encodeFunctionData('claimWithRootUpdate', [
          claimableRewardsData?.totalClaimable,
          claimableRewardsData?.proof,
          0, // penalty bps, at the moment we run with 0; it's a safety feature to hardcode it
          STK_WALLET, // staking pool addr
          claimableRewardsData?.root,
          claimableRewardsData?.signedRoot
        ])
      }
    ],
    meta: {
      chainId: selectedToken.chainId,
      accountAddr: selectedAccount
    }
  }
}

function getTransferRequestParams({
  amount,
  amountInFiat,
  selectedToken,
  selectedAccount,
  recipientAddress: _recipientAddress,
  paymasterService,
  recipientDomain
}: BuildUserRequestParams): {
  calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
  meta: CallsUserRequest['meta']
} | null {
  if (!selectedToken || !selectedAccount || !_recipientAddress) return null

  // if the request is a top up, the recipient is the relayer
  const recipientAddress = _recipientAddress?.toLowerCase()
  const isRecipientFeeCollector = recipientAddress.toLowerCase() === FEE_COLLECTOR.toLowerCase()
  const isNativeToken = Number(selectedToken.address) === 0
  const sanitizedAmount = getSanitizedAmount(amount, selectedToken.decimals)

  const bigNumberHexAmount = `0x${parseUnits(
    sanitizedAmount,
    Number(selectedToken.decimals)
  ).toString(16)}`

  // if the top up is a native one, we should wrap the native before sending it
  // as otherwise a Transfer event is not emitted and the top up will not be
  // recorded. Wrapping is possible only on predefined networks with a wrapped addr
  const wrappedAddr =
    isNativeToken && isRecipientFeeCollector
      ? networks.find((n) => n.chainId === selectedToken.chainId)?.wrappedAddr
      : undefined
  // a native transfer to the fee collector that can't be wrapped (e.g. on a custom network)
  // is sent as a regular transfer. It isn't recorded as a top up, so it shouldn't count
  // towards the gas tank balance
  const isTopUp = isRecipientFeeCollector && (!isNativeToken || !!wrappedAddr)

  if (wrappedAddr) {
    const wrapped = new Interface(WETH)
    const deposit = wrapped.encodeFunctionData('deposit')

    return {
      calls: [
        {
          to: wrappedAddr,
          value: BigInt(bigNumberHexAmount),
          data: deposit
        },
        {
          to: wrappedAddr,
          value: BigInt(0),
          data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
        }
      ],
      meta: {
        chainId: selectedToken.chainId,
        accountAddr: selectedAccount,
        paymasterService,
        topUpAmount: isTopUp && amountInFiat ? amountInFiat : undefined
      }
    }
  }

  let calls: Call[] = [
    {
      to: selectedToken.address,
      value: BigInt(0),
      data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount]),
      recipientDomain
    }
  ]

  if (Number(selectedToken.address) === 0) {
    calls = [
      {
        to: recipientAddress,
        value: BigInt(bigNumberHexAmount),
        data: '0x',
        recipientDomain
      }
    ]
  }

  return {
    calls,
    meta: {
      chainId: selectedToken.chainId,
      accountAddr: selectedAccount,
      paymasterService,
      topUpAmount: isTopUp && amountInFiat ? amountInFiat : undefined
    }
  }
}

interface BuildNftTransferRequestParams {
  nft: TransferNft
  selectedAccount: string
  recipientAddress: string
  recipientDomain: string | undefined
  paymasterService?: PaymasterService
}

/**
 * Builds the call that sends a single ERC-721 NFT from the account to the recipient.
 *
 * `safeTransferFrom` is used instead of `transferFrom` on purpose: if the recipient is a
 * contract that can't handle NFTs, the transaction fails (and it's caught while estimating)
 * instead of the NFT getting stuck in that contract forever.
 *
 * Returns `null` when the params can't produce a safe transfer - e.g. an invalid recipient or
 * a recipient that is the NFT collection contract itself (anything sent there is lost).
 */
function getNftTransferRequestParams({
  nft,
  selectedAccount,
  recipientAddress,
  recipientDomain,
  paymasterService
}: BuildNftTransferRequestParams): {
  calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
  meta: CallsUserRequest['meta']
} | null {
  if (!nft || !isAddress(selectedAccount) || !isAddress(recipientAddress)) return null
  if (recipientAddress.toLowerCase() === nft.address.toLowerCase()) return null

  return {
    calls: [
      {
        to: nft.address,
        value: BigInt(0),
        data: ERC721.encodeFunctionData('safeTransferFrom(address,address,uint256)', [
          selectedAccount,
          recipientAddress,
          nft.tokenId
        ]),
        recipientDomain
      }
    ],
    meta: {
      chainId: nft.chainId,
      accountAddr: selectedAccount,
      paymasterService
    }
  }
}

function getIntentRequestParams({
  selectedToken,
  selectedAccount,
  recipientAddress,
  paymasterService,
  transactions
}: {
  selectedToken: TokenResult
  selectedAccount: string
  recipientAddress: string
  paymasterService?: PaymasterService
  transactions: {
    from: string
    to: string
    value?: string
    data: string
  }[]
}): {
  calls: CallsUserRequest['signAccountOp']['accountOp']['calls']
  meta: CallsUserRequest['meta']
} | null {
  if (!selectedToken || !selectedAccount || !recipientAddress) return null

  const id = uuidv4()

  return {
    calls: transactions.map((transaction, index) => ({
      id: `${id}-${index}`,
      to: transaction.to,
      value: BigInt(transaction.value || '0'),
      data: transaction.data
    })),
    meta: {
      chainId: selectedToken.chainId,
      accountAddr: selectedAccount,
      paymasterService,
      isSwapAndBridgeCall: true,
      activeRouteId: id
    }
  }
}

export {
  getClaimWalletRequestParams,
  getMintVestingRequestParams,
  getTransferRequestParams,
  getNftTransferRequestParams,
  getIntentRequestParams
}
