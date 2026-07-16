function requireE2eCredential(primaryName: string, seedName: string) {
  const value = process.env[primaryName] ?? process.env[seedName];
  if (!value) {
    throw new Error(`${primaryName} is required for E2E authentication (or provide ${seedName}).`);
  }
  return value;
}

export const E2E_ADMIN_PASSWORD = requireE2eCredential(
  "E2E_ADMIN_PASSWORD",
  "QORE_SEED_ADMIN_PASSWORD",
);
export const E2E_QA_PASSWORD = requireE2eCredential("E2E_QA_PASSWORD", "QORE_SEED_QA_PASSWORD");
