import { describe, expect, it } from "vitest";
import { passwordChangeFormSchema, profileNameSchema } from "./profile-form-schemas";

describe("profile form schemas", () => {
  it("trims and validates a profile name", () => {
    expect(profileNameSchema.parse({ name: "  Elena Reyes  " })).toEqual({
      name: "Elena Reyes",
    });
    expect(profileNameSchema.safeParse({ name: "E" }).success).toBe(false);
  });

  it("requires a strong, confirmed password", () => {
    expect(
      passwordChangeFormSchema.safeParse({
        currentPassword: "Current-Pass-9!",
        newPassword: "New-Secure-Pass-9!",
        confirmPassword: "New-Secure-Pass-9!",
      }).success,
    ).toBe(true);

    const mismatch = passwordChangeFormSchema.safeParse({
      currentPassword: "Current-Pass-9!",
      newPassword: "New-Secure-Pass-9!",
      confirmPassword: "Different-Pass-9!",
    });
    expect(mismatch.success).toBe(false);
    if (!mismatch.success) {
      expect(mismatch.error.flatten().fieldErrors.confirmPassword).toContain(
        "Passwords do not match.",
      );
    }
  });
});
