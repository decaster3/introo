import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePagination } from './usePagination';

describe('usePagination', () => {
  const items = Array.from({ length: 50 }, (_, i) => ({ id: i + 1 }));

  it('initializes with correct default values', () => {
    const { result } = renderHook(() => usePagination(items));
    
    expect(result.current.currentPage).toBe(1);
    expect(result.current.totalPages).toBe(3); // 50 items / 20 per page
    expect(result.current.paginatedItems.length).toBe(20);
  });

  it('respects custom items per page', () => {
    const { result } = renderHook(() => 
      usePagination(items, { itemsPerPage: 10 })
    );
    
    expect(result.current.totalPages).toBe(5);
    expect(result.current.paginatedItems.length).toBe(10);
  });

  it('navigates to next page', () => {
    const { result } = renderHook(() => usePagination(items));
    
    act(() => {
      result.current.nextPage();
    });
    
    expect(result.current.currentPage).toBe(2);
    expect(result.current.paginatedItems[0].id).toBe(21);
  });

  it('navigates to previous page', () => {
    const { result } = renderHook(() => 
      usePagination(items, { initialPage: 2 })
    );
    
    act(() => {
      result.current.prevPage();
    });
    
    expect(result.current.currentPage).toBe(1);
  });

  it('does not go below page 1', () => {
    const { result } = renderHook(() => usePagination(items));
    
    act(() => {
      result.current.prevPage();
    });
    
    expect(result.current.currentPage).toBe(1);
  });

  it('does not go beyond total pages', () => {
    const { result } = renderHook(() => 
      usePagination(items, { initialPage: 3 })
    );
    
    act(() => {
      result.current.nextPage();
    });
    
    expect(result.current.currentPage).toBe(3);
  });

  it('goes to specific page', () => {
    const { result } = renderHook(() => usePagination(items));
    
    act(() => {
      result.current.goToPage(3);
    });
    
    expect(result.current.currentPage).toBe(3);
  });

  it('resets to page 1', () => {
    const { result } = renderHook(() => 
      usePagination(items, { initialPage: 2 })
    );
    
    act(() => {
      result.current.resetPage();
    });
    
    expect(result.current.currentPage).toBe(1);
  });

  it('handles empty array', () => {
    const { result } = renderHook(() => usePagination([]));
    
    expect(result.current.totalPages).toBe(1);
    expect(result.current.paginatedItems.length).toBe(0);
  });
});
