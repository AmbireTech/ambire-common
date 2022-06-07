import { useCallback, useMemo } from 'react'

import { Account, OnAddAccountOptions, UseAccountsProps, UseAccountsReturnType } from './types'

export default function useAccounts({
  onAdd,
  onRemoveLastAccount,
  useStorage,
  useToasts
}: UseAccountsProps): UseAccountsReturnType {
  const { addToast } = useToasts()
  const [accounts, setAccounts] = useStorage({
    key: 'accounts',
    defaultValue: [],
    setInit: (initialAccounts) => {
      if (!Array.isArray(initialAccounts)) {
        console.error('accounts: incorrect format')

        return []
      }

      return initialAccounts
    }
  })
  const [selectedAcc, setSelectedAcc] = useStorage({
    key: 'selectedAcc',
    defaultValue: '',
    isStringStorage: true,
    setInit: (initialSelectedAcc) => {
      if (!initialSelectedAcc || !accounts.find((x: Account) => x.id === initialSelectedAcc)) {
        return accounts[0] ? accounts[0].id : ''
      }

      return initialSelectedAcc
    }
  })

  const onSelectAcc = useCallback(
    (selected) => {
      setSelectedAcc(selected)
    },
    [setSelectedAcc]
  )

  const onAddAccount = useCallback(
    (acc: Account, _opts: OnAddAccountOptions = {}) => {
      const opts = { shouldRedirect: true, ..._opts }

      if (!(acc.id && acc.signer)) throw new Error('account: internal err: missing ID or signer')

      const existing = accounts.find((x: Account) => x.id.toLowerCase() === acc.id.toLowerCase())
      if (existing) {
        addToast(
          JSON.stringify(existing) === JSON.stringify(acc)
            ? 'Account already added'
            : 'Account updated'
        )
      } else if (opts.isNew) {
        // @TODO consider something more explanatory such as "using Trezor as a signer", or "this is different from your signer address"
        addToast(
          `New Ambire account created: ${acc.id}${
            acc.signer.address ? '. This is a fresh smart wallet address.' : ''
          }`,
          { timeout: acc.signer.address ? 15000 : 10000 }
        )
      }

      const existingIdx = accounts.indexOf(existing)
      if (existingIdx === -1) accounts.push(acc)
      else accounts[existingIdx] = acc

      // need to make a copy, otherwise no rerender
      setAccounts([...accounts])

      if (opts.select) onSelectAcc(acc.id)
      if (Object.keys(accounts).length) {
        onAdd(opts)
      }
    },
    [accounts, addToast, onSelectAcc, setAccounts, onAdd]
  )

  const onRemoveAccount = useCallback(
    (id) => {
      if (!id) throw new Error('account: internal err: missing ID/Address')

      const account = accounts.find((account: Account) => account.id === id)
      if (account && account.email && account.cloudBackupOptout && !account.downloadedBackup)
        return addToast(
          'You have opted out of Ambire Cloud Backup. Please backup your account before logging out.',
          { error: true, route: '/wallet/security' }
        )

      const clearedAccounts = accounts.filter((account: Account) => account.id !== id)
      setAccounts([...clearedAccounts])

      if (!clearedAccounts.length) {
        setSelectedAcc('')
        onRemoveLastAccount()
      } else onSelectAcc(clearedAccounts[0].id)
    },
    [accounts, onSelectAcc, addToast, onRemoveLastAccount, setAccounts, setSelectedAcc]
  )

  const account: Account = useMemo(
    () => accounts.find((x: Account) => x.id === selectedAcc) || {},
    [selectedAcc, accounts]
  )

  return { accounts, selectedAcc, account, onSelectAcc, onAddAccount, onRemoveAccount }
}
