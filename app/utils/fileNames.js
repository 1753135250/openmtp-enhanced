// Keep POSIX paths separate from Finder display names and shell syntax.
// A Finder display slash is a literal colon in the underlying macOS filename.
export const isValidPosixFilename = (name, legacy = false) => {
  return (
    typeof name === 'string' &&
    name.trim() !== '' &&
    name !== '.' &&
    name !== '..' &&
    !name.includes('/') &&
    !name.includes('\0') &&
    (!legacy || !/[/\\?%*:|"<>]/.test(name))
  );
};

export const isValidTransferPath = (filePath, legacy = false) => {
  return (
    typeof filePath === 'string' &&
    filePath.startsWith('/') &&
    !filePath.includes('\0') &&
    (!legacy || !/[\\:]/.test(filePath))
  );
};
