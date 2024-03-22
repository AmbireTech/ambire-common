import { produceMemoryStore } from '../../../test/helpers'
import { AddressBookController } from './addressBook'

const storage = produceMemoryStore()

// Mock the emitError method to capture the emitted error
const mockEmitError = jest.fn()

describe('AddressBookController', () => {
  const addressBookController = new AddressBookController(storage)

  const getContactFromName = (name: string) => {
    return addressBookController.contacts.find((contact) => contact.name === name)
  }

  // 'any' is on purpose, to override 'emitError' prop (which is protected)
  ;(addressBookController as any).emitError = mockEmitError

  it('address book is empty by default', () => {
    expect(addressBookController.contacts.length).toEqual(0)
  })

  it('add contact', () => {
    addressBookController.addContact('vitaly', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

    expect(getContactFromName('vitaly')?.address).toEqual(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )
  })
  it('rename contact', () => {
    addressBookController.renameContact('vitaly', 'vitalik')

    expect(getContactFromName('vitalik')?.address).toEqual(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )
  })
  it('remove contact', () => {
    addressBookController.removeContact('vitalik')

    expect(getContactFromName('vitalik')).toBeUndefined()
  })
  it('error when removing non-existing contact', () => {
    addressBookController.removeContact('vitalik')

    expect(mockEmitError).toHaveBeenCalledTimes(1)
  })
  it('error when renaming contact to already existing name', () => {
    addressBookController.addContact('vitaly', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    addressBookController.addContact('johnny', '0x31800a810A2d9C3315dc714e1Eb988bd6A641eF0')

    addressBookController.renameContact('vitaly', 'johnny')
    expect(mockEmitError).toHaveBeenCalledTimes(2)
  })
  it('error when adding contact with already existing name/address', () => {
    addressBookController.addContact('tony', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    addressBookController.addContact('tony', '0x31800a810A2d9C3315dc714e1Eb988bd6A641eF0')

    expect(mockEmitError).toHaveBeenCalledTimes(4)
  })
})
