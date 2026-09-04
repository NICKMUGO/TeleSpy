"use client";

import { Keyboard, LogOut, Settings } from "lucide-react";
import { toast } from "sonner";
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
import { mockCurrentUser } from "@/lib/auth/mock-user";

interface UserMenuProps {
  onOpenDisplaySettings: () => void;
  onOpenShortcutsHelp: () => void;
}

export function UserMenu({
  onOpenDisplaySettings,
  onOpenShortcutsHelp,
}: UserMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 gap-2 px-1.5"
          aria-label={`Account menu for ${mockCurrentUser.name}`}
        >
          <Avatar className="size-6">
            <AvatarFallback className="text-xs">
              {mockCurrentUser.initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{mockCurrentUser.name}</span>
          <span className="text-muted-foreground text-xs font-normal">
            {mockCurrentUser.email}
          </span>
          <span className="text-muted-foreground text-xs font-normal">
            {mockCurrentUser.role}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
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
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onSelect={() =>
            toast.info("Sign-out will be wired once authentication is live.")
          }
        >
          <LogOut aria-hidden="true" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
