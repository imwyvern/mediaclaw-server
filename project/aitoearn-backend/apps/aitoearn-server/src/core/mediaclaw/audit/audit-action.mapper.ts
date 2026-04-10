interface RequestLike {
  method?: string
  baseUrl?: string
  route?: {
    path?: string
  }
  originalUrl?: string
  url?: string
  params?: Record<string, any>
  query?: Record<string, any>
  body?: Record<string, any>
}

export interface AuditOperationDescriptor {
  action: string
  resource: string
  resourceId: string
  target: string
  meta: Record<string, unknown>
}

export function resolveAuditOperation(request: RequestLike): AuditOperationDescriptor | null {
  const method = request.method?.toUpperCase() || ''
  const routePattern = buildRoutePattern(request)
  const resource = extractResource(routePattern)
  const resourceId = extractResourceId(request)
  const fallback = buildFallbackDescriptor(method, resource, resourceId, request)
  const mapped = mapKnownRoute(method, routePattern, resourceId, request)

  if (mapped) {
    return mapped
  }

  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
    return null
  }

  return fallback
}

function getRecordValue(record: Record<string, any> | undefined, key: string) {
  return record?.[key]
}

function mapKnownRoute(
  method: string,
  routePattern: string,
  resourceId: string,
  request: RequestLike,
): AuditOperationDescriptor | null {
  if (
    method === 'POST'
    && (
      routePattern === '/api/v1/auth/enterprise/invite'
      || routePattern === '/api/v1/org/members/invite'
      || routePattern === '/api/v1/admin/orgs/:orgId/invite'
    )
  ) {
    return {
      action: 'member.invite',
      resource: 'member',
      resourceId: '',
      target: getRecordValue(request.body, 'phone') || '',
      meta: {
        phone: getRecordValue(request.body, 'phone') || '',
        role: getRecordValue(request.body, 'role') || '',
        orgId: getRecordValue(request.params, 'orgId') || getRecordValue(request.body, 'orgId') || '',
      },
    }
  }

  if (
    method === 'DELETE'
    && (
      routePattern === '/api/v1/org/invites/:inviteId'
      || routePattern === '/api/v1/admin/orgs/:orgId/invites/:inviteId'
    )
  ) {
    return {
      action: 'member.invite.revoke',
      resource: 'member_invite',
      resourceId: getRecordValue(request.params, 'inviteId') || '',
      target: getRecordValue(request.params, 'inviteId') || '',
      meta: {
        orgId: getRecordValue(request.params, 'orgId') || '',
      },
    }
  }

  if (
    method === 'PATCH'
    && (
      routePattern === '/api/v1/org/members/:userId/role'
      || routePattern === '/api/v1/admin/orgs/:orgId/members/:userId/role'
    )
  ) {
    return {
      action: 'member.role.update',
      resource: 'member',
      resourceId: getRecordValue(request.params, 'userId') || resourceId,
      target: getRecordValue(request.params, 'userId') || resourceId,
      meta: {
        role: getRecordValue(request.body, 'role') || '',
        orgId: getRecordValue(request.params, 'orgId') || '',
      },
    }
  }

  if (
    method === 'DELETE'
    && (
      routePattern === '/api/v1/org/members/:userId'
      || routePattern === '/api/v1/admin/orgs/:orgId/members/:userId'
    )
  ) {
    return {
      action: 'member.remove',
      resource: 'member',
      resourceId: getRecordValue(request.params, 'userId') || resourceId,
      target: getRecordValue(request.params, 'userId') || resourceId,
      meta: {
        orgId: getRecordValue(request.params, 'orgId') || '',
      },
    }
  }

  if (
    ['PATCH', 'PUT'].includes(method)
    && (
      routePattern === '/api/v1/org'
      || routePattern === '/api/v1/org/:id'
    )
  ) {
    return {
      action: 'org.update',
      resource: 'org',
      resourceId,
      target: getRecordValue(request.params, 'id') || getRecordValue(request.body, 'orgId') || '',
      meta: {
        fields: Object.keys(request.body || {}),
      },
    }
  }

  if (method === 'PATCH' && routePattern === '/api/v1/admin/orgs/:orgId/status') {
    return {
      action: 'org.status.update',
      resource: 'org',
      resourceId: getRecordValue(request.params, 'orgId') || resourceId,
      target: getRecordValue(request.params, 'orgId') || resourceId,
      meta: {
        status: getRecordValue(request.body, 'status') || '',
      },
    }
  }

  if (method === 'POST' && routePattern === '/api/v1/content/batch-edit') {
    return {
      action: 'content.batch_edit',
      resource: 'content',
      resourceId: '',
      target: `${Array.isArray(getRecordValue(request.body, 'contentIds')) ? getRecordValue(request.body, 'contentIds').length : 0} items`,
      meta: {
        contentIds: Array.isArray(getRecordValue(request.body, 'contentIds')) ? getRecordValue(request.body, 'contentIds') : [],
        updatedFields: Object.keys((getRecordValue(request.body, 'updates') as Record<string, unknown> | undefined) || {}),
      },
    }
  }

  if (method === 'POST' && routePattern === '/api/v1/content/export') {
    return {
      action: 'content.export',
      resource: 'content',
      resourceId: '',
      target: getRecordValue(request.body, 'format') || '',
      meta: {
        format: getRecordValue(request.body, 'format') || '',
        filters: (getRecordValue(request.body, 'filters') as Record<string, unknown> | undefined) || {},
      },
    }
  }

  if (method === 'GET' && routePattern === '/api/v1/content/:id/download') {
    return {
      action: 'content.download',
      resource: 'content',
      resourceId: getRecordValue(request.params, 'id') || resourceId,
      target: getRecordValue(request.params, 'id') || resourceId,
      meta: {},
    }
  }

  if (
    method === 'POST'
    && (
      routePattern === '/api/v1/assets'
    )
  ) {
    return {
      action: 'asset.upload',
      resource: 'asset',
      resourceId: '',
      target: getRecordValue(request.body, 'brandId') || '',
      meta: {
        brandId: getRecordValue(request.body, 'brandId') || '',
        type: getRecordValue(request.body, 'type') || '',
        fileUrl: getRecordValue(request.body, 'fileUrl') || '',
      },
    }
  }

  if (
    method === 'PATCH'
    && (
      routePattern === '/api/v1/assets/:id/activate'
    )
  ) {
    return {
      action: 'asset.activate',
      resource: 'asset',
      resourceId: getRecordValue(request.params, 'id') || resourceId,
      target: getRecordValue(request.params, 'id') || resourceId,
      meta: {},
    }
  }

  if (
    method === 'DELETE'
    && (
      routePattern === '/api/v1/assets/:id'
    )
  ) {
    return {
      action: 'asset.delete',
      resource: 'asset',
      resourceId: getRecordValue(request.params, 'id') || resourceId,
      target: getRecordValue(request.params, 'id') || resourceId,
      meta: {},
    }
  }

  if (method === 'GET' && routePattern === '/api/v1/audit-logs/export') {
    return {
      action: 'audit.export',
      resource: 'audit',
      resourceId: '',
      target: getRecordValue(request.query, 'format') || 'json',
      meta: {
        format: getRecordValue(request.query, 'format') || 'json',
        filters: {
          action: getRecordValue(request.query, 'action'),
          resource: getRecordValue(request.query, 'resource'),
          resourceId: getRecordValue(request.query, 'resourceId'),
          userId: getRecordValue(request.query, 'userId'),
          startDate: getRecordValue(request.query, 'startDate') || getRecordValue(request.query, 'start'),
          endDate: getRecordValue(request.query, 'endDate') || getRecordValue(request.query, 'end'),
        },
      },
    }
  }

  return null
}

function buildFallbackDescriptor(
  method: string,
  resource: string,
  resourceId: string,
  request: RequestLike,
): AuditOperationDescriptor {
  return {
    action: `${resource}.${resolveVerb(method)}`,
    resource,
    resourceId,
    target: resourceId || getRecordValue(request.body, 'id') || getRecordValue(request.query, 'id') || '',
    meta: {
      query: request.query || {},
      bodyKeys: Object.keys(request.body || {}),
    },
  }
}

function resolveVerb(method: string) {
  switch (method) {
    case 'POST':
      return 'create'
    case 'PATCH':
    case 'PUT':
      return 'update'
    case 'DELETE':
      return 'delete'
    default:
      return 'read'
  }
}

function buildRoutePattern(request: RequestLike) {
  const routePath = typeof request.route?.path === 'string'
    ? request.route['path']
    : ''
  const baseUrl = typeof request.baseUrl === 'string'
    ? request.baseUrl
    : ''
  const original = stripQuery(request.originalUrl || request.url || '')

  if (!routePath && !baseUrl) {
    return normalizePath(original)
  }

  return normalizePath(`${baseUrl}/${routePath}`)
}

function extractResource(path: string) {
  const segments = path.split('/').filter(Boolean)

  if (segments.length >= 4 && segments[0] === 'api' && segments[1] === 'v1' && segments[2] === 'admin') {
    return singularize(segments[3] || 'admin')
  }

  if (segments.length >= 3 && segments[0] === 'api' && segments[1] === 'v1') {
    return singularize(segments[2] || 'unknown')
  }

  return singularize(segments[0] || 'unknown')
}

function extractResourceId(request: RequestLike) {
  const params = request.params || {}
  return params['id'] || params['orgId'] || params['userId'] || params['assetId'] || params['resourceId'] || ''
}

function singularize(value: string) {
  return value.endsWith('s') ? value.slice(0, -1) : value
}

function normalizePath(value: string) {
  const normalized = stripQuery(value)
  return normalized
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .replace(/^\/*/, '/')
    || '/'
}

function stripQuery(value: string) {
  return value.split('?')[0] || ''
}
