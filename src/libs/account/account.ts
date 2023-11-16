import { ethers, Interface } from 'ethers'

import { AMBIRE_ACCOUNT_FACTORY } from '../../consts/deploy'
import { SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET } from '../../consts/derivation'
import { networks } from '../../consts/networks'
import { Account } from '../../interfaces/account'
import { Key } from '../../interfaces/keystore'
import { AccountPreferences, KeyPreferences } from '../../interfaces/settings'
import { KnownAddressLabels } from '../humanizer/interfaces'
import { getBytecode } from '../proxyDeploy/bytecode'
import { getAmbireAccountAddress } from '../proxyDeploy/getAmbireAddressTwo'

// returns to, data
export function getAccountDeployParams(account: Account): [string, string] {
  if (account.creation === null) throw new Error('tried to get deployment params for an EOA')
  const factory = new Interface(['function deploy(bytes calldata code, uint256 salt) external'])
  return [
    account.creation.factoryAddr,
    factory.encodeFunctionData('deploy', [account.creation.bytecode, account.creation.salt])
  ]
}

export function getLegacyAccount(key: string): Account {
  return {
    addr: key,
    associatedKeys: [key],
    creation: null
  }
}

export async function getSmartAccount(address: string): Promise<Account> {
  // Temporarily use the polygon network,
  // to be discussed which network we would use for
  // getBytocode once the contract is deployed on all of them
  const polygon = networks.find((x) => x.id === 'polygon')
  if (!polygon) throw new Error('unable to find polygon network in consts')

  const priv = {
    addr: address,
    hash: '0x0000000000000000000000000000000000000000000000000000000000000001'
  }
  const bytecode = await getBytecode(polygon, [priv])

  return {
    addr: getAmbireAccountAddress(AMBIRE_ACCOUNT_FACTORY, bytecode),
    associatedKeys: [address],
    creation: {
      factoryAddr: AMBIRE_ACCOUNT_FACTORY,
      bytecode,
      salt: ethers.toBeHex(0, 32)
    }
  }
}

export const isAmbireV1LinkedAccount = (factoryAddr?: string) =>
  factoryAddr === '0xBf07a0Df119Ca234634588fbDb5625594E2a5BCA'

export const isSmartAccount = (account: Account) => !!account.creation

/**
 * Checks if a (legacy) EOA account is a derived one,
 * that is meant to be used as a smart account key only.
 */
export const isDerivedForSmartAccountKeyOnly = (index: number) =>
  index >= SMART_ACCOUNT_SIGNER_KEY_DERIVATION_OFFSET

/**
 * Map account addresses to their respective labels (if they have ones) in order
 * to display user-friendly labels instead of raw addresses. The addresses
 * for which there is a label are considered "known addresses".
 */
export const getKnownAddressLabels = (
  accounts: Account[],
  accountPreferences: AccountPreferences,
  keys: Key[],
  keyPreferences: KeyPreferences
): KnownAddressLabels => {
  const knownAddressLabels: KnownAddressLabels = {}

  // Check if the address is in the key preferences (lowest priority)
  keys.forEach((key) => {
    // There could be more than one, since there could be more than one key
    // with the same address. In that case, the last (probably newest) one wins.
    const currentKeyPreferences = keyPreferences.findLast((x) => x.addr === key.addr && !!x.label)
    if (currentKeyPreferences) {
      knownAddressLabels[key.addr] = currentKeyPreferences.label
    }
  })

  // TODO: Check if the address is in the address book (second lowest)

  // Check if address is in the account preferences (highest priority)
  accounts.forEach((acc) => {
    const accPref = accountPreferences[acc.addr]
    if (accPref?.label) {
      knownAddressLabels[acc.addr] = accPref.label
    }
  })

  return knownAddressLabels
}
