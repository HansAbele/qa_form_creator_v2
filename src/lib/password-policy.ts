export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

const COMMON_PASSWORD_FRAGMENTS = [
  "password",
  "contrasena",
  "contraseña",
  "change_me",
  "changeme",
  "qwerty",
];

/** Shared client/server policy. The server remains the authoritative enforcement point. */
export function getPasswordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must contain at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Password cannot exceed ${MAX_PASSWORD_LENGTH} characters`;
  }

  const characterClasses = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  if (characterClasses < 3) {
    return "Password must combine at least three character types: uppercase, lowercase, numbers, and symbols";
  }

  const normalized = password.toLocaleLowerCase("en");
  if (COMMON_PASSWORD_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    return "Password contains a common or temporary phrase";
  }

  return null;
}

export function assertStrongPassword(password: string): void {
  const error = getPasswordPolicyError(password);
  if (error) throw new Error(error);
}
