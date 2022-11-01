import { sha256 } from 'ethers/lib/utils'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { isKnownTokenOrContract, isValidAddress } from '../../services/address'
import { setKnownAddresses } from '../../services/humanReadableTransactions'
import { Address, UseAddressBookProps, UseAddressBookReturnType } from './types'

const accountType = ({ email, signerExtra }: any): string => {
  const walletType =
    // eslint-disable-next-line no-nested-ternary
    signerExtra && signerExtra.type === 'ledger'
      ? 'Ledger'
      : signerExtra && signerExtra.type === 'trezor'
      ? 'Trezor'
      : 'Web3'
  return email ? `Ambire account for ${email}` : `Ambire account (${walletType})`
}

const useAddressBook = ({
  useConstants,
  useAccounts,
  useStorage,
  useToasts
}: UseAddressBookProps): UseAddressBookReturnType => {
  const { accounts } = useAccounts()
  const { addToast } = useToasts()
  const [storageAddresses, setStorageAddresses] = useStorage({ key: 'addresses', defaultValue: [] })
  const { constants } = useConstants()

  const addressList = useMemo(() => {
    try {
      const addresses = storageAddresses
      if (!Array.isArray(addresses)) throw new Error('Address Book: incorrect format')
      return [
        ...accounts.map((account) => ({
          isAccount: true,
          name: accountType(account),
          address: account.id
        })),
        ...addresses.map((entry: any) => ({
          ...entry,
          type: entry.type || (entry.isUd ? 'ud' : 'pub')
        }))
      ]
    } catch (e) {
      console.error('Address Book parsing failure', e)
      return []
    }
  }, [accounts, storageAddresses])

  const [addresses, setAddresses] = useState(() => addressList)

  const updateAddresses = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-shadow
    (addresses: any) => {
      setAddresses(
        addresses.map((entry: any) => ({
          ...entry
        }))
      )
      setStorageAddresses(addresses.filter(({ isAccount }: any) => !isAccount))
    },
    [setAddresses, setStorageAddresses]
  )

  const isKnownAddress = useCallback(
    (address: string) => {
      try {
        return [
          // eslint-disable-next-line @typescript-eslint/no-shadow
          ...addresses.map(({ address }: { address: string }) => {
            return address.startsWith('0x') && address.indexOf('.') === -1
              ? sha256(address)
              : address
          }),
          ...accounts.map(({ id }) => sha256(id))
        ].includes(
          address.startsWith('0x') && address.indexOf('.') === -1 ? sha256(address) : address
        )
      } catch (e) {
        console.error(e)
      }
    },
    [addresses, accounts]
  )

  const addAddress = useCallback(
    (name: Address['name'], address: Address['address'], type: Address['type']) => {
      if (!name || !address) throw new Error('Address Book: invalid arguments supplied')

      if (type === 'ens' || type === 'ud') {
        const isFound = addresses.find(
          (item: any) => item.address.toLowerCase() === address.toLowerCase()
        )
        if (isFound)
          return addToast(
            `Address Book: The ${type.toUpperCase()} is already added to the Address book`,
            {
              error: true
            }
          )
      } else {
        const isFound = addresses.find(
          (item: any) => item.address.toLowerCase() === address.toLowerCase()
        )
        if (isFound)
          return addToast('Address Book: The address is already added to the Address book', {
            error: true
          })
        if (!isValidAddress(address)) throw new Error('Address Book: invalid address format')
        if (!!constants?.humanizerInfo && isKnownTokenOrContract(constants.humanizerInfo, address))
          return addToast("The address you're trying to add is a smart contract.", { error: true })
      }

      const newAddresses = [
        ...addresses,
        {
          name,
          address,
          type
        }
      ]

      updateAddresses(newAddresses)

      addToast(`${address} added to your Address Book.`)
    },
    [addresses, addToast, updateAddresses, constants?.humanizerInfo]
  )

  const removeAddress = useCallback(
    (name: Address['name'], address: Address['address'], type: Address['type']) => {
      if (!name || !address) throw new Error('Address Book: invalid arguments supplied')

      if (type !== 'ud' && type !== 'ens') {
        if (!isValidAddress(address)) throw new Error('Address Book: invalid address format')
      }

      const newAddresses = addresses.filter((a: any) => !(a.name === name && a.address === address))

      updateAddresses(newAddresses)

      addToast(`${address} removed from your Address Book.'`)
    },
    [addresses, addToast, updateAddresses]
  )

  useEffect(() => {
    setAddresses(addressList)
  }, [accounts, addressList])

  // a bit of a 'cheat': update the humanizer with the latest known addresses
  // this is breaking the react patterns cause the humanizer has a 'global' state, but that's fine since it simply constantly learns new addr aliases,
  // so there's no 'inconsistent state' there, the more the better
  useEffect(() => setKnownAddresses(addresses), [addresses])

  return {
    addresses,
    addAddress,
    removeAddress,
    isKnownAddress
  }
}

export default useAddressBook
