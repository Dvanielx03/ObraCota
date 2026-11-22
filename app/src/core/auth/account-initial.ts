/** Letter shown in the account avatar: the first letter or digit of the address, upper case. */
export function accountInitial(email: string): string {
  const letter = email.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? letter.toLocaleUpperCase("es") : "?";
}
