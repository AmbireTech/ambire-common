import erc20Abi from 'adex-protocol-eth/abi/ERC20.json'
import { Interface, parseUnits } from 'ethers'
import { SignUserRequest } from 'interfaces/userRequest'

import { TokenResult } from '../portfolio'

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
  const sanitizedAmount = amount.split('.')
  if (sanitizedAmount[1]) sanitizedAmount[1] = sanitizedAmount[1].slice(0, selectedToken.decimals)

  const bigNumberHexAmount = `0x${parseUnits(
    sanitizedAmount.join('.'),
    Number(selectedToken.decimals)
  ).toString(16)}`

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
    action: { kind: 'call' as const, txns: [txn] },
    meta: {
      isSignAction: true,
      networkId: selectedToken.networkId,
      accountAddr: selectedAccount
    }
  }
}

export { buildTransferUserRequest }
