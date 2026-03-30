import { vi } from 'vitest'

async function resolveValue<T>(value: T | (() => T | Promise<T>)) {
  if (typeof value === 'function') {
    return await (value as () => T | Promise<T>)()
  }

  return value
}

export function createExecQuery<T>(value: T | (() => T | Promise<T>)) {
  const query = {
    sort: vi.fn(),
    skip: vi.fn(),
    limit: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockImplementation(async () => resolveValue(value)),
  }

  query.sort.mockReturnValue(query)
  query.skip.mockReturnValue(query)
  query.limit.mockReturnValue(query)
  query.lean.mockReturnValue(query)

  return query
}

export function createChainQuery<T>(value: T | (() => T | Promise<T>)) {
  return createExecQuery(value)
}
