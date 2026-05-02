export const getSourceIp = (
  forwardedForHeader: string | undefined,
): string | undefined => {
  if (!forwardedForHeader) {
    return undefined;
  }

  const [firstIp] = forwardedForHeader
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  return firstIp;
};
