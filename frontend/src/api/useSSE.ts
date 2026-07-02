import { useEffect, useRef, useState, useCallback } from 'react';
import type { ChartData } from '../types/chat';

interface SSEOptions {
  onStep?: (data: { node: string; output: string }) => void;
  onFinalAnswer?: (data: { content: string; chart_url?: string | null; chart_data?: ChartData[] | null; chart_type?: 'bar' | 'line' }) => void;
  onDone?: () => void;
  onError?: (err: unknown) => void;
}

export const useSSE = () => {
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef<number>(0);
  const maxRetries = 3;

  const disconnect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const connect = useCallback((url: string, options: SSEOptions = {}) => {
    disconnect();
    retryCountRef.current = 0;

    const establishConnection = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }

      const eventSource = new EventSource(url, { withCredentials: true });
      eventSourceRef.current = eventSource;
      setIsConnected(true);

      eventSource.addEventListener('step', (event) => {
        retryCountRef.current = 0; // Reset retry count on successful event reception
        try {
          const data = JSON.parse(event.data);
          if (options.onStep) {
            options.onStep(data);
          }
        } catch (e) {
          console.error('Error parsing SSE step event:', e);
        }
      });

      eventSource.addEventListener('final_answer', (event) => {
        retryCountRef.current = 0; // Reset retry count on successful event reception
        try {
          const data = JSON.parse(event.data);
          if (options.onFinalAnswer) {
            options.onFinalAnswer(data);
          }
        } catch (e) {
          console.error('Error parsing SSE final_answer event:', e);
        }
      });

      eventSource.addEventListener('done', () => {
        disconnect();
        if (options.onDone) {
          options.onDone();
        }
      });

      eventSource.addEventListener('error', (event) => {
        eventSource.close();
        if (retryCountRef.current < maxRetries) {
          retryCountRef.current += 1;
          console.warn(`[SSE] Connection error. Retrying ${retryCountRef.current}/${maxRetries} in 3000ms...`);
          setTimeout(() => {
            establishConnection();
          }, 3000);
        } else {
          disconnect();
          if (options.onError) {
            options.onError(event);
          }
        }
      });
    };

    establishConnection();
  }, [disconnect]);

  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return { connect, disconnect, isConnected };
};
