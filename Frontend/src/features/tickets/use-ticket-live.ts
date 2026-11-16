"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  HubConnection,
  HubConnectionBuilder,
  HubConnectionState,
  LogLevel,
} from "@microsoft/signalr";
import { useQueryClient } from "@tanstack/react-query";
import { apiUrl, freshAccessToken } from "@/lib/api/client";
import { queryKeys } from "@/lib/api/hooks";
import type { ApiEnvelope, Ticket, TicketRead } from "@/lib/api/types";
import { useSession } from "@/lib/auth/session-store";

/** Someone with this ticket open in a tab in front of them. */
export interface TicketViewer {
  user_id: string;
  name: string;
}

/** How long "X is typing…" stays up after their last keystroke. */
const TYPING_SHOWN_MS = 4000;
/** Send at most one typing signal this often while someone types. */
const TYPING_THROTTLE_MS = 2500;

/**
 * Live updates for one open ticket (BackendDotNet/Api/TicketsHub.cs).
 * Joins the ticket's group; whenever the server says it changed (a message,
 * claimed, resolved…) the ticket is refetched, so a message appears for
 * everyone viewing it within a moment. Also passes "typing" both ways, and
 * who else has the ticket open right now ("viewers" — a tab in the
 * background doesn't count, so this page reports when it's hidden).
 *
 * One small WebSocket per open ticket page, closed when the page closes —
 * nothing runs in the background. If the connection drops it reconnects by
 * itself; until then the page simply works as before (refresh to update).
 */
export function useTicketLive(ticketId: string) {
  const queryClient = useQueryClient();
  const connectionRef = useRef<HubConnection | null>(null);
  const lastTypingSent = useRef(0);
  const [connected, setConnected] = useState(false);
  const [viewers, setViewers] = useState<TicketViewer[]>([]);
  const myId = useSession((s) => s.user?.id);
  const [typing, setTyping] = useState<{ name: string; until: number } | null>(
    null,
  );

  useEffect(() => {
    if (!ticketId) return;
    let stopped = false;
    const connection = new HubConnectionBuilder()
      .withUrl(apiUrl("/hubs/tickets"), {
        accessTokenFactory: freshAccessToken,
        // Bearer token, not cookies: no credentials needed cross-origin.
        withCredentials: false,
      })
      .withAutomaticReconnect()
      .configureLogging(LogLevel.Warning)
      .build();
    connectionRef.current = connection;

    // In front of them: shown AND focused. On a laptop a window behind
    // others still counts as "visible", and they'd miss notifications
    // about the very ticket they aren't looking at.
    const visible = () =>
      document.visibilityState === "visible" && document.hasFocus();
    const join = async () => {
      const joined = await connection.invoke<boolean>(
        "JoinTicket",
        ticketId,
        visible(),
      );
      if (!stopped) setConnected(joined);
    };
    const onVisibility = () => {
      if (connection.state !== HubConnectionState.Connected) return;
      void connection
        .invoke("SetVisible", ticketId, visible())
        .catch(() => undefined);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("blur", onVisibility);

    connection.on("ticketChanged", (message: { ticket_id: string }) => {
      if (message.ticket_id !== ticketId) return;
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
      // Whoever was typing just sent it.
      setTyping(null);
    });
    connection.on("typing", (message: { ticket_id: string; name: string }) => {
      if (message.ticket_id !== ticketId) return;
      setTyping({ name: message.name, until: Date.now() + TYPING_SHOWN_MS });
    });
    connection.on(
      "viewers",
      (message: { ticket_id: string; viewers: TicketViewer[] }) => {
        if (message.ticket_id !== ticketId) return;
        setViewers(message.viewers);
      },
    );
    // Someone read the conversation: move their read mark here, so my
    // messages turn to two blue ticks without refetching the ticket.
    connection.on("read", (message: TicketRead & { ticket_id: string }) => {
      if (message.ticket_id !== ticketId) return;
      queryClient.setQueryData<ApiEnvelope<Ticket>>(
        queryKeys.ticket(ticketId),
        (old) => {
          if (!old) return old;
          const reads = (old.data.reads ?? []).filter(
            (r) => r.user_id !== message.user_id,
          );
          const { user_id, name, read_at } = message;
          reads.push({ user_id, name, read_at });
          return { ...old, data: { ...old.data, reads } };
        },
      );
    });
    connection.onreconnecting(() => {
      setConnected(false);
      setViewers([]);
    });
    connection.onreconnected(() => {
      // Groups don't survive a reconnect: join again, and catch up on
      // anything missed while offline.
      void join().catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ["tickets"] });
    });
    connection.onclose(() => {
      setConnected(false);
      setViewers([]);
    });

    connection
      .start()
      .then(join)
      .catch(() => {
        // Live updates are a bonus: the page keeps working without them.
        if (!stopped) setConnected(false);
      });

    return () => {
      stopped = true;
      connectionRef.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("blur", onVisibility);
      if (connection.state !== HubConnectionState.Disconnected) {
        void connection.stop();
      }
    };
  }, [ticketId, queryClient]);

  // Hide "typing…" once it goes stale.
  useEffect(() => {
    if (!typing) return;
    const timer = setTimeout(
      () => setTyping(null),
      Math.max(0, typing.until - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [typing]);

  const sendTyping = useCallback(() => {
    const connection = connectionRef.current;
    const now = Date.now();
    if (
      !connection ||
      connection.state !== HubConnectionState.Connected ||
      now - lastTypingSent.current < TYPING_THROTTLE_MS
    ) {
      return;
    }
    lastTypingSent.current = now;
    void connection.invoke("Typing", ticketId).catch(() => undefined);
  }, [ticketId]);

  return {
    connected,
    typingName: typing?.name ?? null,
    sendTyping,
    /** Everyone else viewing the ticket right now (not you). */
    viewers: viewers.filter((v) => v.user_id !== myId),
  };
}
