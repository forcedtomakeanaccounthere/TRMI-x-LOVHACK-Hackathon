import { AuthShell } from "@/components/auth/auth-shell";

// Shared by /login and /signup so the shell persists between them and the panels can swap sides.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
