import { useState, useMemo, useCallback, useEffect } from 'react';

export interface UsePaginationOptions {
  initialPage?: number;
  itemsPerPage?: number;
}

export interface UsePaginationReturn<T> {
  currentPage: number;
  setCurrentPage: (page: number) => void;
  totalPages: number;
  paginatedItems: T[];
  nextPage: () => void;
  prevPage: () => void;
  goToPage: (page: number) => void;
  resetPage: () => void;
}

/**
 * Hook for managing pagination state and logic
 * @param items - Array of items to paginate
 * @param options - Pagination configuration
 */
export function usePagination<T>(
  items: T[],
  options: UsePaginationOptions = {}
): UsePaginationReturn<T> {
  const { initialPage = 1, itemsPerPage = 20 } = options;
  
  const [currentPage, setCurrentPage] = useState(initialPage);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(items.length / itemsPerPage));
  }, [items.length, itemsPerPage]);

  // Reset to page 1 if current page exceeds total pages
  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    return items.slice(startIndex, startIndex + itemsPerPage);
  }, [items, currentPage, itemsPerPage]);

  const goToPage = useCallback((page: number) => {
    const validPage = Math.max(1, Math.min(page, totalPages));
    setCurrentPage(validPage);
  }, [totalPages]);

  const nextPage = useCallback(() => {
    goToPage(currentPage + 1);
  }, [currentPage, goToPage]);

  const prevPage = useCallback(() => {
    goToPage(currentPage - 1);
  }, [currentPage, goToPage]);

  const resetPage = useCallback(() => {
    setCurrentPage(1);
  }, []);

  return {
    currentPage,
    setCurrentPage: goToPage,
    totalPages,
    paginatedItems,
    nextPage,
    prevPage,
    goToPage,
    resetPage,
  };
}

/**
 * Hook for resetting page when filters change
 * @param resetFn - Function to call when any dependency changes
 * @param deps - Dependencies to watch for changes
 */
export function useResetPageOnChange(
  resetFn: () => void,
  deps: React.DependencyList
): void {
  const isFirstRender = useState(true);
  
  useEffect(() => {
    if (isFirstRender[0]) {
      isFirstRender[0] = false;
      return;
    }
    resetFn();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
