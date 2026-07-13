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
        { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', domain: undefined },
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
    })
    test('should filter recipients based on whitelist', () => {
      const whitelist = ['0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C']
      const recipients = getAccountOpRecipients(op, whitelist)

      expect(recipients).toEqual([
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
    })
    test('whitelist is not case-sensitive', () => {
      const whitelist = ['0x53289fa7aa588434dc3e9f584c89b3eb9352db5c']
      const recipients = getAccountOpRecipients(op, whitelist)

      expect(recipients).toEqual([
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
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
        { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', domain: undefined },
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: undefined }
      ])
    })
    test('should include recipientDomain when present on a call', () => {
      const opWithDomain = {
        ...op,
        calls: [{ ...op.calls[0], recipientDomain: 'Sample.ETH' }]
      } as SubmittedAccountOp

      const recipients = getAccountOpRecipients(opWithDomain)

      // call.to and the decoded ERC-20 transfer recipient both inherit the
      // same call's recipientDomain
      expect(recipients).toEqual([
        { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', domain: 'sample.eth' },
        { address: '0x53289fa7Aa588434DC3e9f584c89B3EB9352db5C', domain: 'sample.eth' }
      ])
    })
  })
})
