interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type UseStorageProps<ValueType> = {
  storage: Storage
  key: string
  defaultValue?: ValueType | null
  isStringStorage?: boolean
  setInit?: (item: ValueType | null) => ValueType
}

export type UseStorageReturnType<ValueType> = [ValueType, (item: ValueType) => void, () => void]

export type UseStorageType = <ValueType>(
  p: Omit<UseStorageProps<ValueType>, 'storage'>
) => UseStorageReturnType<ValueType>
