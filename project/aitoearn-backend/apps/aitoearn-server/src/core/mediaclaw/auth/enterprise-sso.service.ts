import type { Document, Element, Node } from '@xmldom/xmldom'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import { DOMParser } from '@xmldom/xmldom'
import {
  EnterpriseSsoProtocol,
  EnterpriseSsoProvider,
  EnterpriseSsoProviderType,
  McUserType,
  MediaClawUser,
  normalizeUserRole,
  Organization,
  OrgType,
  UserRole,
} from '@yikart/mongodb'
import axios from 'axios'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { Model, Types } from 'mongoose'
import { SignedXml } from 'xml-crypto'
import { MediaclawConfigService } from '../mediaclaw-config.service'
import { McAuthService } from './auth.service'
import {
  CreateEnterpriseSsoProviderDto,
  EnterpriseSsoLoginUrlQueryDto,
} from './enterprise-sso.dto'

interface SsoStatePayload {
  providerId: string
  orgId: string
  protocol: EnterpriseSsoProtocol
  callbackUrl: string
  returnUrl?: string
}

interface OidcTokenResponse {
  access_token?: string
  id_token?: string
  token_type?: string
  expires_in?: number
  refresh_token?: string
  scope?: string
  error?: string
  error_description?: string
}

interface SsoProfile {
  subject: string
  email: string
  name: string
  avatarUrl: string
}

@Injectable()
export class EnterpriseSsoService {
  private readonly logger = new Logger(EnterpriseSsoService.name)

  constructor(
    @InjectModel(EnterpriseSsoProvider.name)
    private readonly enterpriseSsoProviderModel: Model<EnterpriseSsoProvider>,
    @InjectModel(MediaClawUser.name)
    private readonly userModel: Model<MediaClawUser>,
    @InjectModel(Organization.name)
    private readonly organizationModel: Model<Organization>,
    private readonly jwtService: JwtService,
    private readonly authService: McAuthService,
    private readonly configService: MediaclawConfigService,
  ) {}

  async createProvider(
    orgId: string,
    userId: string,
    input: CreateEnterpriseSsoProviderDto,
  ) {
    const organization = await this.getEnterpriseOrgOrThrow(orgId)
    const protocol = this.resolveProtocol(input.providerType, input.protocol)
    const now = new Date()

    const provider = await this.enterpriseSsoProviderModel.create({
      providerId: this.buildProviderId(organization._id.toString(), input.name),
      orgId: organization._id.toString(),
      name: input.name.trim(),
      providerType: input.providerType,
      protocol,
      isActive: input.isActive ?? true,
      autoProvision: input.autoProvision ?? true,
      defaultRole: normalizeUserRole(input.defaultRole, UserRole.EMPLOYEE),
      allowedDomains: this.normalizeDomains(input.allowedDomains),
      oidc: protocol === EnterpriseSsoProtocol.OIDC
        ? this.normalizeOidcConfig(input)
        : null,
      saml: protocol === EnterpriseSsoProtocol.SAML
        ? this.normalizeSamlConfig(input)
        : null,
      createdByUserId: userId.trim(),
      updatedByUserId: userId.trim(),
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    })

    return this.serializeProvider(provider.toObject() as EnterpriseSsoProvider)
  }

  async listProviders(orgId: string) {
    await this.getEnterpriseOrgOrThrow(orgId)
    const items = await this.enterpriseSsoProviderModel.find({
      orgId: orgId.trim(),
    }).sort({ createdAt: -1 }).lean().exec()

    return items.map(item => this.serializeProvider(item as EnterpriseSsoProvider))
  }

  async deleteProvider(orgId: string, providerId: string) {
    await this.getEnterpriseOrgOrThrow(orgId)
    const deleted = await this.enterpriseSsoProviderModel.findOneAndDelete({
      orgId: orgId.trim(),
      providerId: providerId.trim(),
    }).lean().exec()
    if (!deleted) {
      throw new NotFoundException('SSO provider not found')
    }

    return {
      providerId: deleted.providerId,
      deleted: true,
    }
  }

  async getLoginUrl(providerId: string, query: EnterpriseSsoLoginUrlQueryDto) {
    const provider = await this.getActiveProviderOrThrow(providerId)
    const callbackUrl = this.resolveCallbackUrl(provider.protocol, query.callbackUrl)
    const state = this.buildStateToken({
      providerId: provider.providerId,
      orgId: provider.orgId,
      protocol: provider.protocol,
      callbackUrl,
      returnUrl: query.returnUrl?.trim() || undefined,
    })
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    const url = provider.protocol === EnterpriseSsoProtocol.OIDC
      ? this.buildOidcLoginUrl(provider, callbackUrl, state)
      : this.buildSamlLoginUrl(provider, callbackUrl, state)

    return {
      providerId: provider.providerId,
      providerType: provider.providerType,
      protocol: provider.protocol,
      callbackUrl,
      url,
      state,
      expiresAt,
    }
  }

  async handleOidcCallback(code: string, state: string) {
    const normalizedCode = code?.trim()
    if (!normalizedCode) {
      throw new BadRequestException('code is required')
    }

    const parsedState = this.parseStateToken(state)
    if (parsedState.protocol !== EnterpriseSsoProtocol.OIDC) {
      throw new BadRequestException('SSO state does not match OIDC flow')
    }

    const provider = await this.getActiveProviderOrThrow(parsedState.providerId)
    const tokenResponse = await this.exchangeOidcCode(provider, normalizedCode, parsedState.callbackUrl)
    const profile = await this.resolveOidcProfile(provider, tokenResponse)
    const authResult = await this.issueAuthResult(provider, profile)

    return {
      ...authResult,
      provider: this.serializeProviderBrief(provider),
      redirectUrl: this.buildReturnUrl(parsedState.returnUrl, authResult),
    }
  }

  async handleSamlAssertion(
    samlResponse: string,
    relayState?: string,
    providerId?: string,
  ) {
    const normalizedResponse = samlResponse?.trim()
    if (!normalizedResponse) {
      throw new BadRequestException('samlResponse is required')
    }

    const parsedState = relayState?.trim()
      ? this.parseStateToken(relayState)
      : null

    const resolvedProviderId = parsedState?.providerId || providerId?.trim()
    if (!resolvedProviderId) {
      throw new BadRequestException('providerId or relayState is required')
    }

    const provider = await this.getActiveProviderOrThrow(resolvedProviderId)
    if (provider.protocol !== EnterpriseSsoProtocol.SAML) {
      throw new BadRequestException('SSO provider is not a SAML provider')
    }

    const profile = this.parseAndValidateSamlResponse(provider, normalizedResponse)
    const authResult = await this.issueAuthResult(provider, profile)

    return {
      ...authResult,
      provider: this.serializeProviderBrief(provider),
      redirectUrl: this.buildReturnUrl(parsedState?.returnUrl, authResult),
    }
  }

  private async issueAuthResult(provider: EnterpriseSsoProvider, profile: SsoProfile) {
    if (!profile.subject) {
      throw new BadRequestException('SSO profile is missing subject')
    }

    const normalizedEmail = profile.email.trim().toLowerCase()
    if (provider.allowedDomains.length > 0) {
      const emailDomain = normalizedEmail.split('@')[1] || ''
      if (!emailDomain || !provider.allowedDomains.includes(emailDomain)) {
        throw new ForbiddenException('SSO account domain is not allowed')
      }
    }

    let user = await this.findUserByExternalIdentity(provider.providerId, profile.subject)
    if (!user && normalizedEmail) {
      user = await this.userModel.findOne({ email: normalizedEmail }).exec()
    }

    let isNewUser = false
    const existingMembership = user
      ? this.findMembership(user, provider.orgId)
      : null

    if (!user && !provider.autoProvision) {
      throw new ForbiddenException('SSO user is not provisioned for this organization')
    }

    if (!user) {
      isNewUser = true
      user = await this.userModel.create({
        email: normalizedEmail || `${profile.subject}@${provider.providerId}.sso.mediaclaw.local`,
        name: profile.name || `${provider.name} 成员`,
        avatarUrl: profile.avatarUrl,
        role: normalizeUserRole(provider.defaultRole, UserRole.EMPLOYEE),
        userType: McUserType.ENTERPRISE,
        orgId: this.toObjectId(provider.orgId, 'orgId'),
        orgMemberships: [{
          orgId: this.toObjectId(provider.orgId, 'orgId'),
          role: normalizeUserRole(provider.defaultRole, UserRole.EMPLOYEE),
          joinedAt: new Date(),
        }],
        externalIdentities: [{
          providerId: provider.providerId,
          providerType: provider.providerType,
          subject: profile.subject,
          email: normalizedEmail,
          linkedAt: new Date(),
          lastLoginAt: new Date(),
        }],
        isActive: true,
        lastLoginAt: new Date(),
      })
    }
    else {
      if (!existingMembership && !provider.autoProvision) {
        throw new ForbiddenException('SSO user is not provisioned for this organization')
      }

      const nextMemberships = existingMembership
        ? this.mergeMemberships(user.orgMemberships || [], provider.orgId, existingMembership.role)
        : this.mergeMemberships(
            user.orgMemberships || [],
            provider.orgId,
            normalizeUserRole(provider.defaultRole, UserRole.EMPLOYEE),
          )

      const updatedUser = await this.userModel.findByIdAndUpdate(
        user._id,
        {
          $set: {
            email: normalizedEmail || user.email,
            name: profile.name || user.name,
            avatarUrl: profile.avatarUrl || user.avatarUrl,
            orgId: this.toObjectId(provider.orgId, 'orgId'),
            role: normalizeUserRole(
              existingMembership?.role || provider.defaultRole,
              normalizeUserRole(user.role, UserRole.EMPLOYEE),
            ),
            userType: McUserType.ENTERPRISE,
            orgMemberships: nextMemberships,
            externalIdentities: this.mergeExternalIdentities(
              (user as any).externalIdentities,
              provider.providerId,
              provider.providerType,
              profile.subject,
              normalizedEmail,
            ),
            isActive: true,
            lastLoginAt: new Date(),
          },
        },
        { new: true },
      ).exec()

      if (!updatedUser) {
        throw new NotFoundException('User not found')
      }
      user = updatedUser
    }

    await this.enterpriseSsoProviderModel.updateOne(
      { _id: provider._id },
      { $set: { lastLoginAt: new Date() } },
    ).exec()

    return this.authService.buildAuthResult(user, isNewUser)
  }

  private async exchangeOidcCode(
    provider: EnterpriseSsoProvider,
    code: string,
    callbackUrl: string,
  ) {
    if (!provider.oidc) {
      throw new BadRequestException('OIDC provider config is missing')
    }

    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: callbackUrl,
      client_id: provider.oidc.clientId,
      client_secret: this.decryptSecret(provider.oidc.clientSecretEncrypted),
    })

    try {
      const response = await axios.post<OidcTokenResponse>(
        provider.oidc.tokenEndpoint,
        body.toString(),
        {
          timeout: 10000,
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
          },
        },
      )

      if (response.data.error) {
        throw new BadRequestException(
          response.data.error_description || response.data.error,
        )
      }

      if (!response.data.access_token && !response.data.id_token) {
        throw new BadRequestException('OIDC token response is missing access_token/id_token')
      }

      return response.data
    }
    catch (error) {
      throw this.wrapAxiosError(error, 'OIDC token exchange failed')
    }
  }

  private async resolveOidcProfile(
    provider: EnterpriseSsoProvider,
    tokenResponse: OidcTokenResponse,
  ) {
    if (!provider.oidc) {
      throw new BadRequestException('OIDC provider config is missing')
    }

    const claims = {} as Record<string, unknown>

    if (tokenResponse.id_token && provider.oidc.jwksUri) {
      const verifiedClaims = await this.verifyIdToken(provider, tokenResponse.id_token)
      Object.assign(claims, verifiedClaims)
    }

    if (provider.oidc.userInfoEndpoint && tokenResponse.access_token) {
      const userInfo = await this.fetchOidcUserInfo(provider, tokenResponse.access_token)
      Object.assign(claims, userInfo)
    }

    if (Object.keys(claims).length === 0) {
      throw new BadRequestException('OIDC provider must expose userInfoEndpoint or jwksUri for claim verification')
    }

    const subject = this.readClaim(claims, provider.oidc.subjectField, [
      'sub',
      'openid',
      'open_id',
      'user_id',
      'unionid',
      'id',
    ])
    const email = this.readClaim(claims, provider.oidc.emailField, [
      'email',
      'mail',
      'preferred_username',
      'upn',
    ])
    const name = this.readClaim(claims, provider.oidc.nameField, [
      'name',
      'nickname',
      'displayName',
      'display_name',
    ])
    const avatarUrl = this.readClaim(claims, provider.oidc.avatarField, [
      'picture',
      'avatar_url',
      'avatar',
      'headimgurl',
    ])

    return {
      subject,
      email: email.toLowerCase(),
      name,
      avatarUrl,
    }
  }

  private async verifyIdToken(provider: EnterpriseSsoProvider, idToken: string) {
    if (!provider.oidc?.jwksUri) {
      throw new BadRequestException('OIDC jwksUri is required to verify id_token')
    }

    const jwks = createRemoteJWKSet(new URL(provider.oidc.jwksUri))
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: provider.oidc.issuer || undefined,
      audience: provider.oidc.clientId,
    })

    return payload as Record<string, unknown>
  }

  private async fetchOidcUserInfo(provider: EnterpriseSsoProvider, accessToken: string) {
    if (!provider.oidc?.userInfoEndpoint) {
      throw new BadRequestException('OIDC userInfoEndpoint is required')
    }

    try {
      const response = await axios.get<Record<string, unknown>>(
        provider.oidc.userInfoEndpoint,
        {
          timeout: 10000,
          headers: {
            authorization: `Bearer ${accessToken}`,
          },
        },
      )
      return response.data
    }
    catch (error) {
      throw this.wrapAxiosError(error, 'OIDC user info fetch failed')
    }
  }

  private parseAndValidateSamlResponse(provider: EnterpriseSsoProvider, samlResponse: string) {
    if (!provider.saml) {
      throw new BadRequestException('SAML provider config is missing')
    }

    const xml = Buffer.from(samlResponse, 'base64').toString('utf8')
    if (!xml.trim()) {
      throw new BadRequestException('SAML response is invalid')
    }

    this.verifySamlSignature(provider, xml)

    const document = new DOMParser().parseFromString(xml, 'text/xml')
    const issuer = this.findFirstText(document, 'Issuer')
    if (!issuer || issuer !== provider.saml.issuer) {
      throw new BadRequestException('SAML issuer mismatch')
    }

    const statusCode = this.findFirstElement(document, 'StatusCode')?.getAttribute('Value') || ''
    if (!statusCode.endsWith(':Success')) {
      throw new BadRequestException('SAML response status is not successful')
    }

    const audience = this.findFirstText(document, 'Audience')
    if (!audience || audience !== provider.saml.audience) {
      throw new BadRequestException('SAML audience mismatch')
    }

    const conditions = this.findFirstElement(document, 'Conditions')
    this.assertSamlTimeWindow(conditions)

    const attributeMap = this.collectSamlAttributes(document)
    const subject = this.resolveSamlSubject(provider, document, attributeMap)
    const email = this.resolveSamlAttribute(
      attributeMap,
      provider.saml.attributeMap?.email,
      ['email', 'mail', 'EmailAddress'],
    )
    const name = this.resolveSamlAttribute(
      attributeMap,
      provider.saml.attributeMap?.name,
      ['name', 'displayName', 'fullName'],
    )
    const avatarUrl = this.resolveSamlAttribute(
      attributeMap,
      provider.saml.attributeMap?.avatar,
      ['avatar', 'picture', 'avatarUrl'],
    )

    return {
      subject,
      email: email.toLowerCase(),
      name,
      avatarUrl,
    }
  }

  private verifySamlSignature(provider: EnterpriseSsoProvider, xml: string) {
    if (!provider.saml?.certificate) {
      throw new BadRequestException('SAML certificate is required')
    }

    const document = new DOMParser().parseFromString(xml, 'text/xml')
    const signatures = this.findElements(document, 'Signature')
    if (signatures.length === 0) {
      throw new BadRequestException('SAML signature is missing')
    }

    const certificate = this.normalizeCertificate(provider.saml.certificate)
    const isValid = signatures.some((signature) => {
      try {
        const validator = new SignedXml({
          publicCert: certificate,
        })
        validator.loadSignature(signature)
        return validator.checkSignature(xml)
      }
      catch {
        return false
      }
    })

    if (!isValid) {
      throw new BadRequestException('SAML signature verification failed')
    }
  }

  private buildOidcLoginUrl(
    provider: EnterpriseSsoProvider,
    callbackUrl: string,
    state: string,
  ) {
    if (!provider.oidc) {
      throw new BadRequestException('OIDC provider config is missing')
    }

    const params = new URLSearchParams({
      client_id: provider.oidc.clientId,
      redirect_uri: callbackUrl,
      response_type: 'code',
      scope: this.resolveScopes(provider),
      state,
    })

    for (const [key, value] of Object.entries(provider.oidc.extraAuthParams || {})) {
      if (typeof value === 'string' && value.trim()) {
        params.set(key, value.trim())
      }
    }

    return `${provider.oidc.authorizationEndpoint}?${params.toString()}`
  }

  private buildSamlLoginUrl(
    provider: EnterpriseSsoProvider,
    callbackUrl: string,
    relayState: string,
  ) {
    if (!provider.saml) {
      throw new BadRequestException('SAML provider config is missing')
    }

    const requestId = `_${randomUUID().replace(/-/g, '')}`
    const issueInstant = new Date().toISOString()
    const entityId = provider.saml.entityId || callbackUrl
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<samlp:AuthnRequest',
      ' xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol"',
      ' xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"',
      ` ID="${requestId}"`,
      ' Version="2.0"',
      ` IssueInstant="${issueInstant}"`,
      ' ProtocolBinding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"',
      ` AssertionConsumerServiceURL="${this.escapeXml(callbackUrl)}"`,
      ` Destination="${this.escapeXml(provider.saml.ssoUrl)}">`,
      `<saml:Issuer>${this.escapeXml(entityId)}</saml:Issuer>`,
      '</samlp:AuthnRequest>',
    ].join('')

    const samlRequest = deflateRawSync(Buffer.from(xml, 'utf8')).toString('base64')
    const params = new URLSearchParams({
      SAMLRequest: samlRequest,
      RelayState: relayState,
    })

    return `${provider.saml.ssoUrl}?${params.toString()}`
  }

  private resolveScopes(provider: EnterpriseSsoProvider) {
    if (provider.oidc?.scopes?.length) {
      return provider.oidc.scopes.join(' ')
    }

    switch (provider.providerType) {
      case EnterpriseSsoProviderType.WECOM:
      case EnterpriseSsoProviderType.FEISHU:
      case EnterpriseSsoProviderType.OIDC:
        return 'openid profile email'
      case EnterpriseSsoProviderType.DINGTALK:
        return 'openid profile'
      default:
        return 'openid profile email'
    }
  }

  private buildStateToken(payload: SsoStatePayload) {
    return this.jwtService.sign(payload, {
      expiresIn: '10m',
      audience: 'mediaclaw-sso-state',
      issuer: 'mediaclaw',
    })
  }

  private parseStateToken(token: string) {
    try {
      return this.jwtService.verify<SsoStatePayload>(token, {
        audience: 'mediaclaw-sso-state',
        issuer: 'mediaclaw',
      })
    }
    catch {
      throw new BadRequestException('SSO state is invalid or expired')
    }
  }

  private resolveCallbackUrl(protocol: EnterpriseSsoProtocol, override?: string) {
    const directOverride = override?.trim()
    if (directOverride) {
      return directOverride
    }

    const configured = protocol === EnterpriseSsoProtocol.OIDC
      ? this.configService.getString(
          ['MEDIACLAW_OIDC_CALLBACK_URL', 'MEDIACLAW_SSO_CALLBACK_URL'],
          '',
        )
      : this.configService.getString(
          ['MEDIACLAW_SAML_ASSERTION_URL', 'MEDIACLAW_SSO_SAML_ASSERTION_URL'],
          '',
        )

    if (configured) {
      return configured
    }

    const baseUrl = this.configService.getString(
      ['MEDIACLAW_BASE_URL', 'MEDIACLAW_PUBLIC_BASE_URL'],
      '',
    )
    if (!baseUrl) {
      throw new BadRequestException('SSO callback URL is not configured')
    }

    return protocol === EnterpriseSsoProtocol.OIDC
      ? `${baseUrl.replace(/\/$/, '')}/api/v1/auth/enterprise/sso/callback`
      : `${baseUrl.replace(/\/$/, '')}/api/v1/auth/enterprise/sso/saml/assertion`
  }

  private async getEnterpriseOrgOrThrow(orgId: string) {
    const normalizedOrgId = this.toObjectId(orgId, 'orgId')
    const organization = await this.organizationModel.findById(normalizedOrgId).exec()
    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    if (organization.type !== OrgType.ENTERPRISE) {
      throw new ForbiddenException('Enterprise SSO is only available for enterprise organizations')
    }

    return organization
  }

  private async getActiveProviderOrThrow(providerId: string) {
    const provider = await this.enterpriseSsoProviderModel.findOne({
      providerId: providerId.trim(),
      isActive: true,
    }).lean().exec()

    if (!provider) {
      throw new NotFoundException('SSO provider not found')
    }

    return provider as EnterpriseSsoProvider
  }

  private async findUserByExternalIdentity(providerId: string, subject: string) {
    return this.userModel.findOne({
      externalIdentities: {
        $elemMatch: {
          providerId: providerId.trim(),
          subject: subject.trim(),
        },
      },
    }).exec()
  }

  private mergeMemberships(
    memberships: Array<{ orgId: Types.ObjectId | { toString: () => string }, role: UserRole, joinedAt: Date }>,
    orgId: string,
    role: UserRole,
  ) {
    const normalizedRole = normalizeUserRole(role, UserRole.EMPLOYEE)
    const existingIndex = memberships.findIndex(item => item.orgId.toString() === orgId)
    if (existingIndex >= 0) {
      return memberships.map((membership, index) =>
        index === existingIndex
          ? {
              ...membership,
              role: normalizedRole,
            }
          : membership,
      )
    }

    return [
      ...memberships,
      {
        orgId: this.toObjectId(orgId, 'orgId'),
        role: normalizedRole,
        joinedAt: new Date(),
      },
    ]
  }

  private findMembership(user: MediaClawUser, orgId: string) {
    return (user.orgMemberships || []).find(item => item.orgId.toString() === orgId) || null
  }

  private mergeExternalIdentities(
    identities: unknown,
    providerId: string,
    providerType: string,
    subject: string,
    email: string,
  ) {
    const normalized = Array.isArray(identities)
      ? identities
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map(item => ({
            providerId: typeof item['providerId'] === 'string' ? item['providerId'] : '',
            providerType: typeof item['providerType'] === 'string' ? item['providerType'] : '',
            subject: typeof item['subject'] === 'string' ? item['subject'] : '',
            email: typeof item['email'] === 'string' ? item['email'] : '',
            linkedAt: item['linkedAt'] instanceof Date ? item['linkedAt'] : new Date(),
            lastLoginAt: item['lastLoginAt'] instanceof Date ? item['lastLoginAt'] : new Date(),
          }))
      : []

    const existingIndex = normalized.findIndex(item =>
      item.providerId === providerId && item.subject === subject,
    )

    if (existingIndex >= 0) {
      normalized[existingIndex] = {
        ...normalized[existingIndex],
        providerType,
        email,
        lastLoginAt: new Date(),
      }
      return normalized
    }

    return [
      ...normalized,
      {
        providerId,
        providerType,
        subject,
        email,
        linkedAt: new Date(),
        lastLoginAt: new Date(),
      },
    ]
  }

  private resolveProtocol(
    providerType: EnterpriseSsoProviderType,
    protocol?: EnterpriseSsoProtocol,
  ) {
    const expected = providerType === EnterpriseSsoProviderType.SAML
      ? EnterpriseSsoProtocol.SAML
      : EnterpriseSsoProtocol.OIDC

    if (protocol && protocol !== expected) {
      throw new BadRequestException(`providerType ${providerType} must use protocol ${expected}`)
    }

    return expected
  }

  private normalizeOidcConfig(input: CreateEnterpriseSsoProviderDto) {
    if (!input.oidc) {
      throw new BadRequestException('oidc config is required')
    }

    if (!input.oidc.userInfoEndpoint?.trim() && !input.oidc.jwksUri?.trim()) {
      throw new BadRequestException('OIDC provider must configure userInfoEndpoint or jwksUri')
    }

    return {
      clientId: input.oidc.clientId.trim(),
      clientSecretEncrypted: this.encryptSecret(input.oidc.clientSecret.trim()),
      authorizationEndpoint: input.oidc.authorizationEndpoint.trim(),
      tokenEndpoint: input.oidc.tokenEndpoint.trim(),
      userInfoEndpoint: input.oidc.userInfoEndpoint?.trim() || '',
      jwksUri: input.oidc.jwksUri?.trim() || '',
      issuer: input.oidc.issuer?.trim() || '',
      scopes: this.normalizeScopes(input.oidc.scopes),
      extraAuthParams: this.normalizeExtraAuthParams(input.oidc.extraAuthParams),
      subjectField: input.oidc.subjectField?.trim() || '',
      emailField: input.oidc.emailField?.trim() || '',
      nameField: input.oidc.nameField?.trim() || '',
      avatarField: input.oidc.avatarField?.trim() || '',
    }
  }

  private normalizeSamlConfig(input: CreateEnterpriseSsoProviderDto) {
    if (!input.saml) {
      throw new BadRequestException('saml config is required')
    }

    return {
      ssoUrl: input.saml.ssoUrl.trim(),
      issuer: input.saml.issuer.trim(),
      audience: input.saml.audience.trim(),
      certificate: this.normalizeCertificate(input.saml.certificate),
      entityId: input.saml.entityId?.trim() || '',
      attributeMap: {
        subject: input.saml.subjectAttribute?.trim() || '',
        email: input.saml.emailAttribute?.trim() || '',
        name: input.saml.nameAttribute?.trim() || '',
        avatar: input.saml.avatarAttribute?.trim() || '',
      },
    }
  }

  private normalizeScopes(scopes?: string[]) {
    if (!Array.isArray(scopes)) {
      return []
    }

    return [...new Set(scopes.map(item => item.trim()).filter(Boolean))]
  }

  private normalizeExtraAuthParams(extra?: Record<string, string>) {
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) {
      return {}
    }

    return Object.fromEntries(
      Object.entries(extra)
        .filter(([, value]) => typeof value === 'string' && value.trim())
        .map(([key, value]) => [key.trim(), value.trim()]),
    )
  }

  private normalizeDomains(domains?: string[]) {
    if (!Array.isArray(domains) || domains.length === 0) {
      return []
    }

    return [...new Set(
      domains
        .map(item => item.trim().toLowerCase())
        .filter(Boolean),
    )]
  }

  private buildProviderId(orgId: string, name: string) {
    const orgSuffix = orgId.slice(-6)
    const nameToken = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'sso'
    return `sso-${orgSuffix}-${nameToken}-${Date.now().toString(36)}`
  }

  private serializeProvider(provider: EnterpriseSsoProvider) {
    return {
      providerId: provider.providerId,
      orgId: provider.orgId,
      name: provider.name,
      providerType: provider.providerType,
      protocol: provider.protocol,
      isActive: provider.isActive,
      autoProvision: provider.autoProvision,
      defaultRole: normalizeUserRole(provider.defaultRole, UserRole.EMPLOYEE),
      allowedDomains: provider.allowedDomains || [],
      oidc: provider.oidc
        ? {
            clientId: provider.oidc.clientId,
            hasClientSecret: Boolean(provider.oidc.clientSecretEncrypted),
            authorizationEndpoint: provider.oidc.authorizationEndpoint,
            tokenEndpoint: provider.oidc.tokenEndpoint,
            userInfoEndpoint: provider.oidc.userInfoEndpoint || '',
            jwksUri: provider.oidc.jwksUri || '',
            issuer: provider.oidc.issuer || '',
            scopes: provider.oidc.scopes || [],
            extraAuthParams: provider.oidc.extraAuthParams || {},
          }
        : null,
      saml: provider.saml
        ? {
            ssoUrl: provider.saml.ssoUrl,
            issuer: provider.saml.issuer,
            audience: provider.saml.audience,
            entityId: provider.saml.entityId || '',
            hasCertificate: Boolean(provider.saml.certificate),
            certificateFingerprint: provider.saml.certificate
              ? createHash('sha256').update(provider.saml.certificate).digest('hex').slice(0, 16)
              : '',
            attributeMap: provider.saml.attributeMap || {},
          }
        : null,
      lastLoginAt: provider.lastLoginAt || null,
      createdAt: provider.createdAt,
      updatedAt: provider.updatedAt,
    }
  }

  private serializeProviderBrief(provider: EnterpriseSsoProvider) {
    return {
      providerId: provider.providerId,
      name: provider.name,
      providerType: provider.providerType,
      protocol: provider.protocol,
      orgId: provider.orgId,
    }
  }

  private buildReturnUrl(
    returnUrl: string | undefined,
    authResult: {
      accessToken: string
      refreshToken: string
      isNewUser: boolean
      user?: Record<string, unknown>
    },
  ) {
    if (!returnUrl?.trim()) {
      return null
    }

    try {
      const url = new URL(returnUrl)
      url.hash = new URLSearchParams({
        accessToken: authResult.accessToken,
        refreshToken: authResult.refreshToken,
        isNewUser: String(authResult.isNewUser),
      }).toString()
      return url.toString()
    }
    catch {
      return null
    }
  }

  private readClaim(
    claims: Record<string, unknown>,
    explicitField: string | undefined,
    fallbacks: string[],
  ) {
    for (const field of [explicitField?.trim() || '', ...fallbacks]) {
      if (!field) {
        continue
      }

      const value = this.readClaimPath(claims, field)
      if (typeof value === 'string' && value.trim()) {
        return value.trim()
      }
    }

    return ''
  }

  private readClaimPath(record: Record<string, unknown>, path: string) {
    const segments = path.split('.').filter(Boolean)
    let current: unknown = record
    for (const segment of segments) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined
      }
      current = (current as Record<string, unknown>)[segment]
    }
    return current
  }

  private collectSamlAttributes(document: Document) {
    const attributes = new Map<string, string>()
    for (const attribute of this.findElements(document, 'Attribute')) {
      const name = attribute.getAttribute('Name')?.trim() || ''
      if (!name) {
        continue
      }

      const value = this.findFirstText(attribute, 'AttributeValue')
      if (value) {
        attributes.set(name, value)
      }
    }
    return attributes
  }

  private resolveSamlSubject(
    provider: EnterpriseSsoProvider,
    document: Document,
    attributes: Map<string, string>,
  ) {
    const mappedSubject = this.resolveSamlAttribute(
      attributes,
      provider.saml?.attributeMap?.subject,
      ['uid', 'sub', 'subject'],
    )
    if (mappedSubject) {
      return mappedSubject
    }

    return this.findFirstText(document, 'NameID')
  }

  private resolveSamlAttribute(
    attributes: Map<string, string>,
    configured: string | undefined,
    fallbacks: string[],
  ) {
    for (const key of [configured?.trim() || '', ...fallbacks]) {
      if (!key) {
        continue
      }
      const value = attributes.get(key)
      if (value?.trim()) {
        return value.trim()
      }
    }

    return ''
  }

  private assertSamlTimeWindow(conditions: Element | null) {
    if (!conditions) {
      return
    }

    const now = Date.now()
    const notBefore = conditions.getAttribute('NotBefore')
    const notOnOrAfter = conditions.getAttribute('NotOnOrAfter')

    if (notBefore) {
      const timestamp = new Date(notBefore).getTime()
      if (!Number.isNaN(timestamp) && now < timestamp) {
        throw new BadRequestException('SAML assertion is not active yet')
      }
    }

    if (notOnOrAfter) {
      const timestamp = new Date(notOnOrAfter).getTime()
      if (!Number.isNaN(timestamp) && now >= timestamp) {
        throw new BadRequestException('SAML assertion has expired')
      }
    }
  }

  private findFirstText(root: Document | Element, localName: string) {
    const element = this.findFirstElement(root, localName)
    return element?.textContent?.trim() || ''
  }

  private findFirstElement(root: Document | Element, localName: string) {
    return this.findElements(root, localName)[0] || null
  }

  private findElements(root: Document | Element, localName: string) {
    const matches = [] as Element[]
    const visit = (node: Node) => {
      if (node.nodeType === 1) {
        const element = node as Element
        if (element.localName === localName) {
          matches.push(element)
        }
      }

      const children = node.childNodes || []
      for (let index = 0; index < children.length; index += 1) {
        const child = children.item(index)
        if (child) {
          visit(child)
        }
      }
    }

    visit(root)
    return matches
  }

  private encryptSecret(secret: string) {
    const key = this.resolveEncryptionKey()
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()

    return ['v1', iv.toString('base64'), authTag.toString('base64'), encrypted.toString('base64')].join(':')
  }

  private decryptSecret(payload: string) {
    const [version, ivBase64, authTagBase64, encryptedBase64] = payload.split(':')
    if (version !== 'v1' || !ivBase64 || !authTagBase64 || !encryptedBase64) {
      throw new BadRequestException('Stored SSO secret payload is invalid')
    }

    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.resolveEncryptionKey(),
      Buffer.from(ivBase64, 'base64'),
    )
    decipher.setAuthTag(Buffer.from(authTagBase64, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(encryptedBase64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }

  private resolveEncryptionKey() {
    const raw = this.configService.getString(
      ['MEDIACLAW_SSO_ENCRYPTION_KEY', 'BYOK_ENCRYPTION_KEY'],
      '',
    )
    if (!raw) {
      throw new BadRequestException('SSO encryption key is not configured')
    }

    if (/^[a-f0-9]{64}$/i.test(raw)) {
      return Buffer.from(raw, 'hex')
    }

    const utf8 = Buffer.from(raw, 'utf8')
    if (utf8.length === 32) {
      return utf8
    }

    try {
      const base64 = Buffer.from(raw, 'base64')
      if (base64.length === 32) {
        return base64
      }
    }
    catch {
      // Ignore invalid base64 and hash the input.
    }

    return createHash('sha256').update(raw).digest()
  }

  private normalizeCertificate(certificate: string) {
    const trimmed = certificate.trim()
    if (!trimmed) {
      throw new BadRequestException('SAML certificate is required')
    }

    if (trimmed.includes('BEGIN CERTIFICATE') || trimmed.includes('BEGIN PUBLIC KEY')) {
      return trimmed
    }

    const body = trimmed.replace(/\s+/g, '')
    const chunks = body.match(/.{1,64}/g) || [body]
    return `-----BEGIN CERTIFICATE-----\n${chunks.join('\n')}\n-----END CERTIFICATE-----`
  }

  private escapeXml(value: string) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&apos;')
  }

  private wrapAxiosError(error: unknown, fallbackMessage: string) {
    if (axios.isAxiosError(error)) {
      const message = typeof error.response?.data === 'object' && error.response?.data
        ? JSON.stringify(error.response.data)
        : error.message
      return new BadRequestException(`${fallbackMessage}: ${message}`)
    }

    return error instanceof Error
      ? new BadRequestException(`${fallbackMessage}: ${error.message}`)
      : new BadRequestException(fallbackMessage)
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`)
    }

    return new Types.ObjectId(value)
  }
}
