"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Keyboard, LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
import {
  InstallAppMenuItem,
  IosInstallDialog,
} from "@/components/pwa/install-app";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { logout as apiLogout } from "@/lib/api/auth";
import { useSession } from "@/lib/auth/session-store";

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/);
  return (
    (parts[0]?.[0] ?? "") +
    (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")
  );
}

interface UserMenuProps {
  onOpenDisplaySettings: () => void;
  onOpenShortcutsHelp: () => void;
  onOpenTutorial: () => void;
}

export function UserMenu({
  onOpenDisplaySettings,
  onOpenShortcutsHelp,
  onOpenTutorial,
}: UserMenuProps) {
  const router = useRouter();
  const user = useSession((state) => state.user);
  const clearSession = useSession((state) => state.clear);
  const [iosInstallHelp, setIosInstallHelp] = useState(false);

  const name = user?.full_name ?? user?.email ?? "Account";
  const initials = initialsFor(name).toUpperCase() || "?";

  async function handleLogout() {
    try {
      await apiLogout();
    } catch {
      // Sign the user out locally regardless — a failed /auth/logout call
      // (network blip, already-expired token) shouldn't trap them signed in.
    }
    clearSession();
    toast.success("Signed out.");
    router.push("/login");
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 gap-2 px-1.5"
            aria-label={`Account menu for ${name}`}
          >
            <Avatar className="size-6">
              <AvatarFallback className="text-xs">{initials}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{name}</span>
            <span className="text-muted-foreground text-xs font-normal">
              {user?.email}
            </span>
            <span className="text-muted-foreground text-xs font-normal">
              {user?.role}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onOpenTutorial}>
            <GraduationCap aria-hidden="true" />
            <span>Tutorial</span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenDisplaySettings}>
            <Settings aria-hidden="true" />
            <span>Display settings</span>
            <DropdownMenuShortcut>Ctrl+,</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onOpenShortcutsHelp}>
            <Keyboard aria-hidden="true" />
            <span>Keyboard shortcuts</span>
            <DropdownMenuShortcut>?</DropdownMenuShortcut>
          </DropdownMenuItem>
          <InstallAppMenuItem onShowIosHelp={() => setIosInstallHelp(true)} />
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
            <LogOut aria-hidden="true" />
            <span>Log out</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <IosInstallDialog
        open={iosInstallHelp}
        onOpenChange={setIosInstallHelp}
      />
    </>
  );
}
