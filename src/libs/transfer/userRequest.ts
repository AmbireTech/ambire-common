import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { Interface, parseUnits } from 'ethers'

import WETH from '../../../contracts/compiled/WETH.json'
import { FEE_COLLECTOR } from '../../consts/addresses'
import { networks } from '../../consts/networks'
import { Calls, SignUserRequest } from '../../interfaces/userRequest'
import { TokenResult } from '../../libs/portfolio'
import { getSanitizedAmount } from './amount'

const ERC20 = new Interface(erc20Abi)

interface BuildUserRequestParams {
  amount: string
  selectedToken: TokenResult
  selectedAccount: string
  recipientAddress: string
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
  const isNativeTopUp = Number(selectedToken.address) === 0 && recipientAddress === FEE_COLLECTOR
  if (isNativeTopUp) {
    // if not predefined network, we cannot make a native top up
    const network = networks.find((net) => net.id === selectedToken.networkId)
    if (!network) return null

    // if a wrapped addr is not specified, we cannot make a native top up
    const wrappedAddr = network.wrappedAddr
    if (!wrappedAddr) return null

    const wrapped = new Interface(WETH)
    const deposit = wrapped.encodeFunctionData('deposit')
    const txns: Calls = {
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
      action: txns,
      meta: {
        isSignAction: true,
        networkId: selectedToken.networkId,
        accountAddr: selectedAccount
      }
    }
  }

  const txn = {
    kind: 'call' as const,
    to: selectedToken.address,
    value: BigInt(0),
    data: ERC20.encodeFunctionData('transfer', [recipientAddress, bigNumberHexAmount])
  }

  if (Number(selectedToken.address) === 0) {
    txn.to = recipientAddress
    txn.value = BigInt(bigNumberHexAmount)
    txn.data = '0x'
  }

  return {
    id: new Date().getTime(),
    action: txn,
    meta: {
      isSignAction: true,
      networkId: selectedToken.networkId,
      accountAddr: selectedAccount
    }
  }
}

export { buildTransferUserRequest }
