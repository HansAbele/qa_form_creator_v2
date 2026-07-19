import { z } from "zod";
import { getPasswordPolicyError } from "@/lib/password-policy";

export const profileNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Full name must contain at least 2 characters.")
    .max(100, "Full name cannot exceed 100 characters."),
});

const newPasswordSchema = z.string().superRefine((password, context) => {
  if (getPasswordPolicyError(password)) {
    context.addIssue({
      code: "custom",
      message: "The new password does not meet the security requirements.",
    });
  }
});

export const passwordChangeActionSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password."),
  newPassword: newPasswordSchema,
});

export const passwordChangeFormSchema = passwordChangeActionSchema
  .extend({
    confirmPassword: z.string().min(1, "Confirm your new password."),
  })
  .refine(({ newPassword, confirmPassword }) => newPassword === confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type ProfileNameFormValues = z.infer<typeof profileNameSchema>;
export type PasswordChangeFormValues = z.infer<typeof passwordChangeFormSchema>;
