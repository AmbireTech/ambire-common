interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export type UseStorageProps = {
  storage: Storage
  key: string
  defaultValue?: any
  isStringStorage?: boolean
  setInit?: (item: any) => any
}

export type UseStorageReturnType<ValueType> = [ValueType, (item: ValueType) => void, () => void]
