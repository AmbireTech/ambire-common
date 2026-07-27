import { Erc7730ResolvedDescriptor } from './types'

export const MULTICALL_SELECTOR = '0xac9650d8'

export const MULTICALL_DESCRIPTOR: Erc7730ResolvedDescriptor = {
  path: 'built-in/multicall',
  descriptor: {
    display: {
      formats: {
        'multicall(bytes[] data)': {
          intent: 'Multicall',
          fields: [
            {
              path: '#.data.[]',
              label: 'Call',
              format: 'calldata',
              params: { calleePath: '@.to' },
              visible: 'always'
            }
          ]
        }
      }
    }
  }
}
