/**
 * Shared pagination helpers so every platform list view behaves identically:
 * a sensible default page size, 1-based page numbers, and a clamped page so an
 * out-of-range `?page=` never yields an empty view.
 */

export const DEFAULT_PAGE_SIZE = 20;

export interface ResolvedPage {
  page: number; // 1-based, clamped to [1, pageCount]
  pageCount: number;
  pageSize: number;
  total: number;
  skip: number;
  take: number;
}

/**
 * Turn a raw `?page=` value and a known total into concrete paging bounds.
 * Call the module's count() first, then this, then list() with skip/take.
 */
export function resolvePage(
  raw: string | undefined,
  total: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): ResolvedPage {
  const parsed = Number.parseInt(raw ?? '1', 10);
  const requested = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requested, pageCount);
  return {
    page,
    pageCount,
    pageSize,
    total,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}
