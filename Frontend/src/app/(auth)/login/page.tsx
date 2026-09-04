import type { Metadata } from "next";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = {
  title: "Sign in — TeleSpy",
};

export default function LoginPage() {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <div className="mb-2 flex items-center gap-2">
          <span
            aria-hidden="true"
            className="bg-primary text-primary-foreground flex size-7 shrink-0 items-center justify-center rounded-sm text-sm font-bold"
          >
            T
          </span>
          <span className="text-sm font-semibold tracking-tight">TeleSpy</span>
        </div>
        <CardTitle asChild className="text-xl">
          <h1>Sign in</h1>
        </CardTitle>
        <CardDescription>
          Use your Kenya Airways work account to continue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <LoginForm />
      </CardContent>
    </Card>
  );
}
