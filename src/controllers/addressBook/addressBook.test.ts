import { produceMemoryStore } from '../../../test/helpers'
import { AddressBookController } from './addressBook'

const storage = produceMemoryStore()

// Mock the emitError method to capture the emitted error
const mockEmitError = jest.fn()

describe('AddressBookController', () => {
  const addressBookController = new AddressBookController(storage)

  // 'any' is on purpose, to override 'emitError' prop (which is protected)
  ;(addressBookController as any).emitError = mockEmitError

  it('address book is empty by default', () => {
    expect(Object.keys(addressBookController.contacts).length).toEqual(0)
  })

  it('add contact', () => {
    addressBookController.addContact('vitaly', '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')

    expect(addressBookController.contacts.vitaly).toEqual(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )
  })
  it('rename contact', () => {
    addressBookController.renameContact('vitaly', 'vitalik')

    expect(addressBookController.contacts.vitalik).toEqual(
      '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    )
  })
  it('remove contact', () => {
    addressBookController.removeContact('vitalik')

    expect(addressBookController.contacts.vitalik).toBeUndefined()
  })
  it('error when removing non-existing contact', () => {
    addressBookController.removeContact('vitalik')

    expect(mockEmitError).toHaveBeenCalledTimes(1)
  })
})
