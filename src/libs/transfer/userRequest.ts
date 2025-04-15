import { Interface, parseUnits } from 'ethers'

import IERC20 from '../../../contracts/compiled/IERC20.json'
import WALLETSupplyControllerABI from '../../../contracts/compiled/WALLETSupplyController.json'
import WETH from '../../../contracts/compiled/WETH.json'
import { FEE_COLLECTOR, SUPPLY_CONTROLLER_ADDR, WALLET_STAKING_ADDR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { Calls, SignUserRequest } from '../../interfaces/userRequest'
import { AddrVestingData, ClaimableRewardsData, TokenResult } from '../portfolio'
import { getSanitizedAmount } from './amount'

const ERC20 = new Interface(IERC20.abi)
const supplyControllerInterface = new Interface(WALLETSupplyControllerABI)

interface BuildUserRequestParams {
  amount: string
  selectedToken: TokenResult
  selectedAccount: string
  recipientAddress: string
}

function buildMintVestingRequest({
  selectedAccount,
  selectedToken,
  addrVestingData
}: {
  selectedAccount: string
  selectedToken: TokenResult
  addrVestingData: AddrVestingData
}): SignUserRequest {
  const txn = {
    kind: 'calls' as Calls['kind'],
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
    ]
  }
  return {
    id: new Date().getTime(),
    action: txn,
    meta: {
      isSignAction: true,
      chainId: selectedToken.chainId,
      accountAddr: selectedAccount
    }
  }
}

function buildClaimWalletRequest({
  selectedAccount,
  selectedToken,
  claimableRewardsData
}: {
  selectedAccount: string
  selectedToken: TokenResult
  claimableRewardsData: ClaimableRewardsData
}): SignUserRequest {
  const txn = {
    kind: 'calls' as Calls['kind'],
    calls: [
      {
        to: SUPPLY_CONTROLLER_ADDR,
        value: BigInt(0),
        data: supplyControllerInterface.encodeFunctionData('claimWithRootUpdate', [
          claimableRewardsData?.totalClaimable,
          claimableRewardsData?.proof,
          0, // penalty bps, at the moment we run with 0; it's a safety feature to hardcode it
          WALLET_STAKING_ADDR, // staking pool addr
          claimableRewardsData?.root,
          claimableRewardsData?.signedRoot
        ])
      }
    ]
  }
  return {
    id: new Date().getTime(),
    action: txn,
    meta: {
      isSignAction: true,
      chainId: selectedToken.chainId,
      accountAddr: selectedAccount
    }
  }
}

function buildTransferUserRequest({
  amount,
  selectedToken,
  selectedAccount,
  recipientAddress: _recipientAddress
}: BuildUserRequestParams): SignUserRequest | null {
  if (!selectedToken || !selectedAccount || !_recipientAddress) return null

  // if the request is a top up, the recipient is the relayer
  const recipientAddress = _recipientAddress?.toLowerCase()
  const sanitizedAmount = getSanitizedAmount(amount, selectedToken.decimals)

  const bigNumberHexAmount = `0x${parseUnits(
    sanitizedAmount,
    Number(selectedToken.decimals)
  ).toString(16)}`

  // if the top up is a native one, we should wrap the native before sending it
  // as otherwise a Transfer event is not emitted and the top up will not be
  // recorded
  const isNativeTopUp =
    Number(selectedToken.address) === 0 &&
    recipientAddress.toLowerCase() === FEE_COLLECTOR.toLowerCase()
  if (isNativeTopUp) {
    // if not predefined network, we cannot make a native top up
    const network = networks.find((n) => n.chainId === selectedToken.chainId)
    if (!network) return null

    // if a wrapped addr is not specified, we cannot make a native top up
    const wrappedAddr = network.wrappedAddr
    if (!wrappedAddr) return null

    const wrapped = new Interface(WETH)
    const deposit = wrapped.encodeFunctionData('deposit')
    const calls: Calls = {
      kind: 'calls' as const,
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
      ]
    }
    return {
      id: new Date().getTime(),
      action: calls,
      meta: {
        isSignAction: true,
        chainId: selectedToken.chainId,
        accountAddr: selectedAccount
      }
    }
  }

  const txn = {
    kind: 'calls' as const,
    calls: [
      {
        to: selectedToken.address,
        value: BigInt(0),
        data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
      }
    ]
  }

  if (Number(selectedToken.address) === 0) {
    txn.calls = [
      {
        to: recipientAddress,
        value: BigInt(bigNumberHexAmount),
        data: '0x'
      }
    ]
  }

  return {
    id: new Date().getTime(),
    action: txn,
    meta: {
      isSignAction: true,
      chainId: selectedToken.chainId,
      accountAddr: selectedAccount
    }
  }
}

export { buildTransferUserRequest, buildClaimWalletRequest, buildMintVestingRequest }
