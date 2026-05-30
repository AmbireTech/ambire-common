import type { Dapp } from '../../src/interfaces/dapp'

export const makeDapp = ({
  id,
  name,
  url,
  ...overrides
}: Pick<Dapp, 'id' | 'name' | 'url'> & Partial<Dapp>): Dapp => ({
  id,
  name,
  url,
  description: '',
  icon: null,
  category: null,
  tvl: null,
  twitter: null,
  geckoId: null,
  chainIds: [1],
  isConnected: false,
  isFeatured: false,
  isCustom: false,
  chainId: 1,
  favorite: false,
  blacklisted: 'VERIFIED',
  ...overrides
})

export const verifiedDapp = makeDapp({
  id: 'verified-dapp.com',
  name: 'Verified Dapp',
  url: 'https://verified-dapp.com',
  blacklisted: 'VERIFIED'
})

export const loadingDapp = makeDapp({
  id: 'loading-dapp.com',
  name: 'Loading Dapp',
  url: 'https://loading-dapp.com',
  blacklisted: 'LOADING'
})

export const failedDapp = makeDapp({
  id: 'failed-dapp.com',
  name: 'Failed Dapp',
  url: 'https://failed-dapp.com',
  blacklisted: 'FAILED_TO_GET'
})

export const blacklistedDapp = makeDapp({
  id: 'blacklisted-dapp.com',
  name: 'Blacklisted Dapp',
  url: 'https://blacklisted-dapp.com',
  blacklisted: 'BLACKLISTED'
})

export const customDapp = makeDapp({
  id: 'custom-dapp.com',
  name: 'Custom Dapp',
  url: 'https://custom-dapp.com',
  blacklisted: 'VERIFIED',
  isCustom: true
})

export const getDappVerificationTestDapps = () => [
  makeDapp({
    id: 'verified-dapp.com',
    name: 'Verified Dapp',
    url: 'https://verified-dapp.com',
    blacklisted: 'VERIFIED'
  }),
  makeDapp({
    id: 'loading-dapp.com',
    name: 'Loading Dapp',
    url: 'https://loading-dapp.com',
    blacklisted: 'LOADING'
  }),
  makeDapp({
    id: 'failed-dapp.com',
    name: 'Failed Dapp',
    url: 'https://failed-dapp.com',
    blacklisted: 'FAILED_TO_GET'
  }),
  makeDapp({
    id: 'blacklisted-dapp.com',
    name: 'Blacklisted Dapp',
    url: 'https://blacklisted-dapp.com',
    blacklisted: 'BLACKLISTED'
  }),
  makeDapp({
    id: 'custom-dapp.com',
    name: 'Custom Dapp',
    url: 'https://custom-dapp.com',
    blacklisted: 'VERIFIED',
    isCustom: true
  })
]

export const getDappRequestData = (dapp: Dapp) => ({
  name: dapp.name,
  icon: dapp.icon || '',
  url: dapp.url
})
