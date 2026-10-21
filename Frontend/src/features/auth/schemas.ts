import { z } from "zod";

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Enter your work email.")
    .email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginValues = z.infer<typeof loginSchema>;

export const otpSchema = z.object({
  otp: z
    .string()
    .min(1, "Enter the verification code.")
    .regex(/^\d{6}$/, "Enter the 6-digit code from your email."),
});

export type OtpValues = z.infer<typeof otpSchema>;

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .min(1, "Enter your work email.")
    .email("Enter a valid email address."),
});

export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

// Mirrors BackendDotNet's Validators.RequireStrongPassword, so the common
// mistakes are caught before the token is spent on a round trip. The
// backend stays the authority (it also rejects reuse of recent passwords).
export const resetPasswordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, "Use at least 8 characters.")
      .regex(/[A-Z]/, "Include an uppercase letter.")
      .regex(/[a-z]/, "Include a lowercase letter.")
      .regex(/\d/, "Include a digit.")
      .regex(/[^A-Za-z0-9]/, "Include a symbol."),
    confirmPassword: z.string().min(1, "Re-enter the new password."),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "The passwords don't match.",
    path: ["confirmPassword"],
  });

export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
