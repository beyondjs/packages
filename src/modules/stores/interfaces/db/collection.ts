export /*bundle*/ interface ICollection<IItemData> {
	get(params: { id: string }): Promise<IItemData | void>;
	set(params: { id: string; data: IItemData }): Promise<void>;
	delete(params: { id: string }): Promise<void>;
}
