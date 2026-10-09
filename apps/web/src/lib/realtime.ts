'use client';

import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  RT_NAMESPACE,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@flight13/shared';
import { API_URL } from './config';

export type RtEventName = keyof ServerToClientEvents & string;
export type RtPayload<E extends RtEventName> = Parameters<ServerToClientEvents[E]>[0];

export type RtState = 'connecting' | 'online' | 'offline';

type RtSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: RtSocket | null = null;

/**
 * One shared socket per browser tab: the handshake reuses the httpOnly
 * `f13_at` cookie (same-site API origin, `withCredentials`), so no token ever
 * touches page JavaScript. Reconnection is socket.io's job.
 */
function getSocket(): RtSocket {
  if (!socket) {
    socket = io(`${API_URL}${RT_NAMESPACE}`, {
      withCredentials: true,
      reconnection: true,
      reconnectionDelayMax: 5_000,
    });
  }
  return socket;
}

/**
 * Subscribe `handler` to realtime events while this component sits in
 * `rooms`. The handler is kept in a ref so callers may rebuild it each
 * render without rejoining; rooms are rejoined whenever their content
 * changes (and on reconnect via the `connect` listener).
 */
export function useRealtime(
  rooms: string[],
  handler: (event: RtEventName, payload: unknown) => void,
): RtState {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  const [state, setState] = useState<RtState>('connecting');
  const roomKey = rooms.join(',');

  useEffect(() => {
    const s = getSocket();
    const roomList = roomKey ? roomKey.split(',') : [];

    const joinAll = () => {
      setState('online');
      for (const room of roomList) s.emit('room.join', { room });
    };
    const onDisconnect = () => setState('offline');
    const onEvent = (event: RtEventName, ...args: unknown[]) => {
      if (event === 'ack' || event === 'error') return; // protocol chatter
      handlerRef.current(event, args[0]);
    };

    s.on('connect', joinAll);
    s.on('disconnect', onDisconnect);
    s.onAny(onEvent);
    if (s.connected) joinAll();

    return () => {
      s.off('connect', joinAll);
      s.off('disconnect', onDisconnect);
      s.offAny(onEvent);
      for (const room of roomList) s.emit('room.leave', { room });
    };
  }, [roomKey]);

  return state;
}
