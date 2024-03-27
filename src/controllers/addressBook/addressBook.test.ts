import { produceMemoryStore } from '../../../test/helpers'
import { AddressBookController } from './addressBook'

const storage = produceMemoryStore()

let errors = 0

// Mock the emitError method to capture the emitted error
const mockEmitError = jest.fn(() => errors++)

describe('AddressBookController', () => {
  const addressBookController = new AddressBookController(storage)

  const getContactFromName = (name: string) => {
    return addressBookController.contacts.find((contact) => contact.name === name)
  }

  // 'any' is on purpose, to override 'emitError' prop (which is protected)
  ;(addressBookController as any).emitError = mockEmitError

  it('address book is empty by default', () => {
    expect(addressBookController.contacts.length).toEqual(errors)
  })

  it('add contact', async () => {
    await addressBookController.addContact('vitaly', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

    expect(getContactFromName('vitaly')?.address).toEqual(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )
  })
  it('rename contact', async () => {
    await addressBookController.renameManuallyAddedContact(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      'vitalik'
    )

    expect(getContactFromName('vitalik')?.address).toEqual(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )
  })
  it('remove contact', async () => {
    await addressBookController.removeManuallyAddedContact(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )

    expect(getContactFromName('vitalik')).toBeUndefined()
  })
  it('add wallet accounts to contacts', () => {
    addressBookController.accountsInWalletContacts = [
      {
        address: '0x66fE93c51726e6FD51668B0B0434ffcedD604d08',
        name: 'Account 1'
      },
      {
        address: '0x31800a810A2d9C3315dc714e1Eb988bd6A641eF0',
        name: 'Account 2'
      }
    ]

    expect(getContactFromName('Account 1')?.isWalletAccount).toBeTruthy()
    expect(getContactFromName('Account 1')?.address).toEqual(
      '0x66fE93c51726e6FD51668B0B0434ffcedD604d08'
    )
    expect(getContactFromName('Account 2')?.isWalletAccount).toBeTruthy()
    expect(getContactFromName('Account 2')?.address).toEqual(
      '0x31800a810A2d9C3315dc714e1Eb988bd6A641eF0'
    )
  })
  it('contact address is checksummed when added', async () => {
    await addressBookController.addContact(
      'Jeff',
      '0x64c5f3c58E024170166F85aFE6e291088a2c2968'.toLowerCase()
    )

    expect(getContactFromName('Jeff')?.address).toEqual(
      '0x64c5f3c58E024170166F85aFE6e291088a2c2968'
    )
  })
  it('error when removing non-existing contact', async () => {
    await addressBookController.removeManuallyAddedContact(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )

    expect(mockEmitError).toHaveBeenCalledTimes(errors)
  })
  it('error when adding contact with already existing address', async () => {
    await addressBookController.addContact('tony', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    await addressBookController.addContact('tony', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

    expect(mockEmitError).toHaveBeenCalledTimes(errors)
  })
  it('error when adding contact with already existing address but lowercased', async () => {
    await addressBookController.addContact('tony', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    await addressBookController.addContact('tony', '0xd8da6bf26964af9d7eed9e03e53415d37aa96045')

    expect(mockEmitError).toHaveBeenCalledTimes(errors)
  })
  it('error when renaming wallet account contact', async () => {
    await addressBookController.renameManuallyAddedContact(
      '0x66fE93c51726e6FD51668B0B0434ffcedD604d08',
      'Account 2'
    )

    expect(mockEmitError).toHaveBeenCalledTimes(errors)
  })
  it('error when removing wallet account contact', async () => {
    await addressBookController.removeManuallyAddedContact(
      '0x66fE93c51726e6FD51668B0B0434ffcedD604d08'
    )

    expect(mockEmitError).toHaveBeenCalledTimes(errors)
  })
})
