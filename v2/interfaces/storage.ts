export interface Storage {
	get(key: string, defaultValue: any): Promise<any>
	set(key: string, value: any): Promise<null>
}

