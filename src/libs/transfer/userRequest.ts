import { Interface, parseUnits } from 'ethers'
import { v4 as uuidv4 } from 'uuid'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import WALLETSupplyControllerABI from '../../../contracts/compiled/WALLETSupplyController.json'
import WETH from '../../../contracts/compiled/WETH.json'
import { FEE_COLLECTOR, STK_WALLET, SUPPLY_CONTROLLER_ADDR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { CallsUserRequest } from '../../interfaces/userRequest'
import { PaymasterService } from '../erc7677/types'
import { AddrVestingData, ClaimableRewardsData, TokenResult } from '../portfolio'
import { getSanitizedAmount } from './amount'

const ERC20 = new Interface(IERC20.abi)
const supplyControllerInterface = new Interface(WALLETSupplyControllerABI)

interface BuildUserRequestParams {
  amount: string
  selectedToken: TokenResult
  selectedAccount: string
  recipientAddress: string
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
  calls: CallsUserRequest['accountOp']['calls']
  meta: CallsUserRequest['meta']
} {
  return {
    calls: [
      {
        id: uuidv4(),
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
  calls: CallsUserRequest['accountOp']['calls']
  meta: CallsUserRequest['meta']
} {
  return {
    calls: [
      {
        id: uuidv4(),
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
  paymasterService
}: BuildUserRequestParams): {
  calls: CallsUserRequest['accountOp']['calls']
  meta: CallsUserRequest['meta']
} | null {
  if (!selectedToken || !selectedAccount || !_recipientAddress) return null

  // if the request is a top up, the recipient is the relayer
  const recipientAddress = _recipientAddress?.toLowerCase()
  const isTopUp = recipientAddress.toLowerCase() === FEE_COLLECTOR.toLowerCase()
  const sanitizedAmount = getSanitizedAmount(amount, selectedToken.decimals)

  const bigNumberHexAmount = `0x${parseUnits(
    sanitizedAmount,
    Number(selectedToken.decimals)
  ).toString(16)}`

  // if the top up is a native one, we should wrap the native before sending it
  // as otherwise a Transfer event is not emitted and the top up will not be
  // recorded
  const isNativeTopUp = Number(selectedToken.address) === 0 && isTopUp

  if (isNativeTopUp) {
    // if not predefined network, we cannot make a native top up
    const network = networks.find((n) => n.chainId === selectedToken.chainId)
    if (!network) return null

    // if a wrapped addr is not specified, we cannot make a native top up
    const wrappedAddr = network.wrappedAddr
    if (!wrappedAddr) return null

    const wrapped = new Interface(WETH)
    const deposit = wrapped.encodeFunctionData('deposit')

    return {
      calls: [
        {
          id: uuidv4(),
          to: wrappedAddr,
          value: BigInt(bigNumberHexAmount),
          data: deposit
        },
        {
          id: uuidv4(),
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

  let calls = [
    {
      id: uuidv4(),
      to: selectedToken.address,
      value: BigInt(0),
      data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
    }
  ]

  if (Number(selectedToken.address) === 0) {
    calls = [
      {
        id: uuidv4(),
        to: recipientAddress,
        value: BigInt(bigNumberHexAmount),
        data: '0x'
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
  calls: CallsUserRequest['accountOp']['calls']
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
  getIntentRequestParams
}
