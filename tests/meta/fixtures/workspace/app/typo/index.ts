// Invalid on purpose, for its types only: ImportMeta declares hot, not hott (TS2551, which suggests hot)
export const hot = import.meta.hott;
