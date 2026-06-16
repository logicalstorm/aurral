export const omitKey = (object, key) => {
  const next = { ...object };
  delete next[key];
  return next;
};
