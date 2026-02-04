import { getAccountOpRecipients, SubmittedAccountOp } from './submittedAccountOp'

describe('SubmittedAccountOp', () => {
  describe('getAccountOpRecipients', () => {
    const op = {
      accountAddr: '0xB674F3fd5F43464dB0448a57529eAF37F04cceA5',
      chainId: 1n,
      calls: [
        {
          data: '0xa9059cbb00000000000000000000000053289fa7aa588434dc3e9f584c89b3eb9352db5c0000000000000000000000000000000000000000000000000000000000007530',
          to: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
          value: 0n
        }
      ]
    } as SubmittedAccountOp

    test('should return recipients from calls', () => {
      const recipients = getAccountOpRecipients(op)

      expect(recipients).toEqual([
        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C'
      ])
    })
    test('should filter recipients based on whitelist', () => {
      const whitelist = ['0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C']
      const recipients = getAccountOpRecipients(op, whitelist)

      expect(recipients).toEqual(['0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C'])
    })
    test('whitelist is not case-sensitive', () => {
      const whitelist = ['0x53289fa7aa588434dc3e9f584c89b3eb9352db5c']
      const recipients = getAccountOpRecipients(op, whitelist)

      expect(recipients).toEqual(['0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C'])
    })
    test('same address in multiple calls should appear only once', () => {
      const opWithDuplicates = {
        ...op,
        calls: [
          ...op.calls,
          ...op.calls // duplicate calls
        ]
      } as SubmittedAccountOp

      const recipients = getAccountOpRecipients(opWithDuplicates)

      expect(recipients).toEqual([
        '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
        '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C'
      ])
    })
  })
})
