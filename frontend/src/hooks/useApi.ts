import { useState, useCallback } from 'react';

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export interface UseApiReturn<T> extends UseApiState<T> {
  execute: () => Promise<T | null>;
  reset: () => void;
}

/**
 * Generic hook for API calls with loading and error state management
 * @param fetcher - Async function that returns data
 * @param immediate - Whether to execute immediately on mount (default: false)
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  immediate = false
): UseApiReturn<T> {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: immediate,
    error: null,
  });

  const execute = useCallback(async (): Promise<T | null> => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetcher();
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      setState(prev => ({ ...prev, loading: false, error: err }));
      return null;
    }
  }, [fetcher]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, execute, reset };
}

/**
 * Hook for API calls that should execute immediately and can be refreshed
 */
export function useFetch<T>(
  fetcher: () => Promise<T>,
  deps: React.DependencyList = []
): UseApiState<T> & { refetch: () => Promise<T | null> } {
  const [state, setState] = useState<UseApiState<T>>({
    data: null,
    loading: true,
    error: null,
  });

  const refetch = useCallback(async (): Promise<T | null> => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetcher();
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      setState(prev => ({ ...prev, loading: false, error: err }));
      return null;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Execute on mount and when deps change
  useState(() => {
    refetch();
  });

  return { ...state, refetch };
}

/**
 * Hook for mutations (POST, PUT, DELETE) with loading state
 */
export function useMutation<TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>
): {
  mutate: (variables: TVariables) => Promise<TData | null>;
  data: TData | null;
  loading: boolean;
  error: Error | null;
  reset: () => void;
} {
  const [state, setState] = useState<UseApiState<TData>>({
    data: null,
    loading: false,
    error: null,
  });

  const mutate = useCallback(async (variables: TVariables): Promise<TData | null> => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    try {
      const data = await mutationFn(variables);
      setState({ data, loading: false, error: null });
      return data;
    } catch (error) {
      const err = error instanceof Error ? error : new Error('Unknown error');
      setState(prev => ({ ...prev, loading: false, error: err }));
      return null;
    }
  }, [mutationFn]);

  const reset = useCallback(() => {
    setState({ data: null, loading: false, error: null });
  }, []);

  return { ...state, mutate, reset };
}
