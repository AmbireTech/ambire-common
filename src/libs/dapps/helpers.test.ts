import predefinedDapps from '../../consts/dappCatalog.json'
import { patchStorageApps } from './helpers'

describe('Test dapp helpers', () => {
  describe('patchStorageApps', () => {
    const predefinedDappsFormatted = predefinedDapps.map((dapp) => ({
      ...dapp,
      isConnected: false,
      favorite: false,
      chainId: 1
    }))
    it('Shouldnt remove any dapps from the latest predefined list', () => {
      const afterPatch = patchStorageApps(predefinedDappsFormatted)

      expect(afterPatch.length).toBe(predefinedDapps.length)
    })
    it('Should remove legends.ambire.com from the list', () => {
      const afterPatch = patchStorageApps([
        ...predefinedDappsFormatted,
        {
          name: 'Ambire Legends',
          url: 'https://legends.ambire.com',
          icon: '',
          description: '',
          favorite: false,
          chainId: 1,
          isConnected: false
        }
      ])
      expect(afterPatch.length).toBe(predefinedDapps.length)
    })
  })
})
