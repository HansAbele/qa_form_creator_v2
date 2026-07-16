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
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `La contraseña no puede exceder ${MAX_PASSWORD_LENGTH} caracteres`;
  }

  const characterClasses = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  if (characterClasses < 3) {
    return "La contraseña debe combinar al menos tres tipos: mayúsculas, minúsculas, números y símbolos";
  }

  const normalized = password.toLocaleLowerCase("es");
  if (COMMON_PASSWORD_FRAGMENTS.some((fragment) => normalized.includes(fragment))) {
    return "La contraseña contiene una expresión común o temporal";
  }

  return null;
}

export function assertStrongPassword(password: string): void {
  const error = getPasswordPolicyError(password);
  if (error) throw new Error(error);
}
