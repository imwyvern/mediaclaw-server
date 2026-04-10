import { Types } from 'mongoose'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EnterpriseSsoService } from './enterprise-sso.service'

vi.mock('@yikart/mongodb', () => {
  class EnterpriseSsoProvider {}
  class MediaClawUser {}
  class Organization {}

  return {
    EnterpriseSsoProvider,
    EnterpriseSsoProtocol: {
      OIDC: 'oidc',
      SAML: 'saml',
    },
    EnterpriseSsoProviderType: {
      WECOM: 'wecom',
      DINGTALK: 'dingtalk',
      FEISHU: 'feishu',
      OIDC: 'oidc',
      SAML: 'saml',
    },
    McUserType: {
      ENTERPRISE: 'enterprise',
    },
    MediaClawUser,
    normalizeUserRole: (role: string | null | undefined, fallback = 'viewer') => {
      if (!role) {
        return fallback
      }
      if (role === 'super_admin') {
        return 'super_admin'
      }
      if (role === 'admin') {
        return 'admin'
      }
      if (role === 'editor') {
        return 'editor'
      }
      return 'viewer'
    },
    Organization,
    OrgType: {
      ENTERPRISE: 'enterprise',
    },
    UserRole: {
      SUPER_ADMIN: 'super_admin',
      ENTERPRISE_ADMIN: 'admin',
      OPERATOR: 'editor',
      EMPLOYEE: 'viewer',
      ADMIN: 'admin',
      EDITOR: 'editor',
      VIEWER: 'viewer',
    },
  }
})

function createExecQuery<T>(value: T) {
  const query = {
    sort: vi.fn(),
    lean: vi.fn(),
    exec: vi.fn().mockResolvedValue(value),
  }
  query.sort.mockReturnValue(query)
  query.lean.mockReturnValue(query)
  return query
}

function createOidcProvider(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    providerId: 'sso-org001-feishu-demo',
    orgId: new Types.ObjectId().toString(),
    name: '飞书企业登录',
    providerType: 'feishu',
    protocol: 'oidc',
    isActive: true,
    autoProvision: true,
    defaultRole: 'viewer',
    allowedDomains: ['example.com'],
    oidc: {
      clientId: 'client-id',
      clientSecretEncrypted: 'encrypted-secret',
      authorizationEndpoint: 'https://sso.example.com/oauth2/authorize',
      tokenEndpoint: 'https://sso.example.com/oauth2/token',
      userInfoEndpoint: 'https://sso.example.com/userinfo',
      jwksUri: '',
      issuer: 'https://sso.example.com',
      scopes: ['openid', 'profile', 'email'],
      extraAuthParams: {},
      subjectField: '',
      emailField: '',
      nameField: '',
      avatarField: '',
    },
    saml: null,
    lastLoginAt: null,
    createdAt: new Date('2026-04-10T18:00:00.000Z'),
    updatedAt: new Date('2026-04-10T18:00:00.000Z'),
    ...overrides,
  }
}

describe('enterpriseSsoService behavior', () => {
  let service: EnterpriseSsoService
  let enterpriseSsoProviderModel: Record<string, any>
  let userModel: Record<string, any>
  let organizationModel: Record<string, any>
  let jwtService: Record<string, any>
  let authService: Record<string, any>
  let configService: Record<string, any>

  beforeEach(() => {
    enterpriseSsoProviderModel = {
      create: vi.fn(),
      find: vi.fn(),
      findOne: vi.fn(),
      findOneAndDelete: vi.fn(),
      updateOne: vi.fn().mockReturnValue(createExecQuery({ acknowledged: true })),
    }
    userModel = {
      create: vi.fn(),
      findOne: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    }
    organizationModel = {
      findById: vi.fn(),
    }
    jwtService = {
      sign: vi.fn().mockReturnValue('signed-state'),
      verify: vi.fn(),
    }
    authService = {
      buildAuthResult: vi.fn().mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        isNewUser: true,
        user: { id: 'user-1' },
      }),
    }
    configService = {
      getString: vi.fn((keys: string | string[], fallback = '') => {
        const list = Array.isArray(keys) ? keys : [keys]
        if (list.includes('MEDIACLAW_SSO_ENCRYPTION_KEY')) {
          return '12345678901234567890123456789012'
        }
        if (list.includes('MEDIACLAW_OIDC_CALLBACK_URL')) {
          return 'https://api.example.com/api/v1/auth/enterprise/sso/callback'
        }
        if (list.includes('MEDIACLAW_SAML_ASSERTION_URL')) {
          return 'https://api.example.com/api/v1/auth/enterprise/sso/saml/assertion'
        }
        return fallback
      }),
    }

    service = new EnterpriseSsoService(
      enterpriseSsoProviderModel as any,
      userModel as any,
      organizationModel as any,
      jwtService as any,
      authService as any,
      configService as any,
    )
  })

  it('应创建并加密企业 SSO OIDC provider', async () => {
    const orgId = new Types.ObjectId()
    const created = createOidcProvider({
      orgId: orgId.toString(),
      oidc: {
        clientId: 'client-id',
        clientSecretEncrypted: 'v1:encrypted',
        authorizationEndpoint: 'https://sso.example.com/oauth2/authorize',
        tokenEndpoint: 'https://sso.example.com/oauth2/token',
        userInfoEndpoint: 'https://sso.example.com/userinfo',
        jwksUri: '',
        issuer: 'https://sso.example.com',
        scopes: ['openid', 'email'],
        extraAuthParams: {},
        subjectField: '',
        emailField: '',
        nameField: '',
        avatarField: '',
      },
      toObject() {
        return this
      },
    })

    organizationModel.findById.mockReturnValue(createExecQuery({
      _id: orgId,
      type: 'enterprise',
      name: '今斑堂',
    }))
    enterpriseSsoProviderModel.create.mockResolvedValue(created)

    const result = await service.createProvider(orgId.toString(), 'user-1', {
      name: '飞书企业登录',
      providerType: 'feishu' as any,
      oidc: {
        clientId: 'client-id',
        clientSecret: 'plain-secret',
        authorizationEndpoint: 'https://sso.example.com/oauth2/authorize',
        tokenEndpoint: 'https://sso.example.com/oauth2/token',
        userInfoEndpoint: 'https://sso.example.com/userinfo',
      },
    })

    expect(enterpriseSsoProviderModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        providerType: 'feishu',
        protocol: 'oidc',
        oidc: expect.objectContaining({
          clientId: 'client-id',
          clientSecretEncrypted: expect.not.stringContaining('plain-secret'),
        }),
      }),
    )
    expect(result.oidc).toMatchObject({
      clientId: 'client-id',
      hasClientSecret: true,
    })
  })

  it('应生成 OIDC 登录地址并带上签名 state', async () => {
    const provider = createOidcProvider()
    enterpriseSsoProviderModel.findOne.mockReturnValue(createExecQuery(provider))

    const result = await service.getLoginUrl(provider.providerId, {})

    expect(jwtService.sign).toHaveBeenCalled()
    expect(result.url).toContain(provider.oidc.authorizationEndpoint)
    expect(result.url).toContain('client_id=client-id')
    expect(result.url).toContain('response_type=code')
    expect(result.url).toContain('state=signed-state')
  })

  it('应在 OIDC callback 中自动建链企业用户', async () => {
    const provider = createOidcProvider()
    const providerIdQuery = createExecQuery(provider)
    enterpriseSsoProviderModel.findOne.mockReturnValue(providerIdQuery)
    jwtService.verify.mockReturnValue({
      providerId: provider.providerId,
      orgId: provider.orgId,
      protocol: 'oidc',
      callbackUrl: 'https://api.example.com/api/v1/auth/enterprise/sso/callback',
    })
    userModel.findOne
      .mockReturnValueOnce(createExecQuery(null))
      .mockReturnValueOnce(createExecQuery(null))
    userModel.create.mockResolvedValue({
      _id: new Types.ObjectId(),
      email: 'boss@example.com',
      name: '老板',
      role: 'viewer',
      orgId: new Types.ObjectId(provider.orgId),
      userType: 'enterprise',
      orgMemberships: [],
      externalIdentities: [],
      isActive: true,
      lastLoginAt: new Date(),
    })

    vi.spyOn(service as any, 'exchangeOidcCode').mockResolvedValue({
      access_token: 'token',
    })
    vi.spyOn(service as any, 'resolveOidcProfile').mockResolvedValue({
      subject: 'ou_123',
      email: 'boss@example.com',
      name: '老板',
      avatarUrl: 'https://example.com/avatar.png',
    })

    const result = await service.handleOidcCallback('code-123', 'signed-state')

    expect(userModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'boss@example.com',
        externalIdentities: expect.arrayContaining([
          expect.objectContaining({
            providerId: provider.providerId,
            subject: 'ou_123',
          }),
        ]),
      }),
    )
    expect(authService.buildAuthResult).toHaveBeenCalled()
    expect(result.provider).toMatchObject({
      providerId: provider.providerId,
      protocol: 'oidc',
    })
  })

  it('应支持 SAML assertion 登录并复用已有企业成员', async () => {
    const provider = createOidcProvider({
      providerId: 'sso-org001-saml-demo',
      providerType: 'saml',
      protocol: 'saml',
      autoProvision: false,
      allowedDomains: [],
      oidc: null,
      saml: {
        ssoUrl: 'https://saml.example.com/login',
        issuer: 'https://saml.example.com/entity',
        audience: 'mediaclaw',
        certificate: 'pem-cert',
        entityId: 'mediaclaw',
        attributeMap: {},
      },
    })
    const existingUser = {
      _id: new Types.ObjectId(),
      email: 'editor@example.com',
      name: '编辑',
      avatarUrl: '',
      role: 'editor',
      orgId: new Types.ObjectId(provider.orgId),
      userType: 'enterprise',
      orgMemberships: [{
        orgId: new Types.ObjectId(provider.orgId),
        role: 'editor',
        joinedAt: new Date(),
      }],
      externalIdentities: [],
      isActive: true,
      lastLoginAt: new Date(),
    }
    const updatedUser = {
      ...existingUser,
      externalIdentities: [{
        providerId: provider.providerId,
        providerType: 'saml',
        subject: 'alice',
        email: 'editor@example.com',
        linkedAt: new Date(),
        lastLoginAt: new Date(),
      }],
    }

    enterpriseSsoProviderModel.findOne.mockReturnValue(createExecQuery(provider))
    userModel.findOne.mockReturnValue(createExecQuery(existingUser))
    userModel.findByIdAndUpdate.mockReturnValue(createExecQuery(updatedUser))
    vi.spyOn(service as any, 'parseAndValidateSamlResponse').mockReturnValue({
      subject: 'alice',
      email: 'editor@example.com',
      name: '编辑',
      avatarUrl: '',
    })

    const result = await service.handleSamlAssertion('base64-assertion', undefined, provider.providerId)

    expect(userModel.findByIdAndUpdate).toHaveBeenCalled()
    expect(result.provider).toMatchObject({
      providerId: provider.providerId,
      protocol: 'saml',
    })
  })
})
