import {
  LayerBillingModel,
  LayerBillingPolicy,
  LayerPermissionPolicy,
  LayerQuotaPolicy,
  UserRole,
} from '@yikart/mongodb'

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback
}

export function normalizeStringList(values: unknown) {
  if (!Array.isArray(values)) {
    return []
  }

  return [...new Set(values.map(value => normalizeString(value)).filter(Boolean))]
}

function normalizeExtras(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {}
}

export function normalizeLayerQuotaPolicy(
  input?: Partial<LayerQuotaPolicy> | null,
): LayerQuotaPolicy {
  return {
    enabled: input?.enabled ?? true,
    monthlyLimit: Number(input?.monthlyLimit || 0),
    dailyLimit: Number(input?.dailyLimit || 0),
    concurrencyLimit: Number(input?.concurrencyLimit || 0),
    storageLimitGb: Number(input?.storageLimitGb || 0),
    seatLimit: Number(input?.seatLimit || 0),
    extras: normalizeExtras(input?.extras),
  }
}

export function normalizeLayerBillingPolicy(
  input?: Partial<LayerBillingPolicy> | null,
  defaultMode: LayerBillingModel = LayerBillingModel.QUOTA,
): LayerBillingPolicy {
  return {
    mode: input?.mode || defaultMode,
    baseFeeCents: Number(input?.baseFeeCents || 0),
    includedUnits: Number(input?.includedUnits || 0),
    overageUnitPriceCents: Number(input?.overageUnitPriceCents || 0),
    currency: normalizeString(input?.currency, 'CNY'),
    billableUnit: normalizeString(input?.billableUnit, 'request'),
    extras: normalizeExtras(input?.extras),
  }
}

export function normalizeLayerPermissionPolicy(
  input?: Partial<LayerPermissionPolicy> | null,
): LayerPermissionPolicy {
  return {
    adminRoles: normalizeStringList(input?.adminRoles).length > 0
      ? normalizeStringList(input?.adminRoles)
      : [UserRole.SUPER_ADMIN, UserRole.ENTERPRISE_ADMIN],
    operatorRoles: normalizeStringList(input?.operatorRoles).length > 0
      ? normalizeStringList(input?.operatorRoles)
      : [UserRole.OPERATOR],
    viewerRoles: normalizeStringList(input?.viewerRoles).length > 0
      ? normalizeStringList(input?.viewerRoles)
      : [UserRole.EMPLOYEE],
    requiresApproval: input?.requiresApproval ?? false,
    allowMarketplaceInstall: input?.allowMarketplaceInstall ?? true,
    allowCrossInstanceAnalytics: input?.allowCrossInstanceAnalytics ?? true,
    extras: normalizeExtras(input?.extras),
  }
}

export function mergeQuotaPolicy(
  base: LayerQuotaPolicy,
  override: LayerQuotaPolicy,
) {
  return {
    ...base,
    ...override,
    extras: {
      ...(base.extras || {}),
      ...(override.extras || {}),
    },
  }
}

export function mergeBillingPolicy(
  base: LayerBillingPolicy,
  override: LayerBillingPolicy,
) {
  return {
    ...base,
    ...override,
    extras: {
      ...(base.extras || {}),
      ...(override.extras || {}),
    },
  }
}

export function mergePermissionPolicy(
  base: LayerPermissionPolicy,
  override: LayerPermissionPolicy,
) {
  return {
    ...base,
    ...override,
    adminRoles: override.adminRoles?.length ? override.adminRoles : base.adminRoles,
    operatorRoles: override.operatorRoles?.length ? override.operatorRoles : base.operatorRoles,
    viewerRoles: override.viewerRoles?.length ? override.viewerRoles : base.viewerRoles,
    extras: {
      ...(base.extras || {}),
      ...(override.extras || {}),
    },
  }
}
