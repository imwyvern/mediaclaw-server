import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { Schema as MongooseSchema } from 'mongoose'

import { DEFAULT_SCHEMA_OPTIONS } from '../mongodb.constants'
import { USER_ROLE_STORAGE_VALUES, UserRole } from './mediaclaw-user.schema'
import { WithTimestampSchema } from './timestamp.schema'

export enum EnterpriseSsoProviderType {
  WECOM = 'wecom',
  DINGTALK = 'dingtalk',
  FEISHU = 'feishu',
  OIDC = 'oidc',
  SAML = 'saml',
}

export enum EnterpriseSsoProtocol {
  OIDC = 'oidc',
  SAML = 'saml',
}

@Schema({ _id: false })
export class EnterpriseSsoOidcConfig {
  @Prop({ type: String, required: true })
  clientId: string

  @Prop({ type: String, required: true })
  clientSecretEncrypted: string

  @Prop({ type: String, required: true })
  authorizationEndpoint: string

  @Prop({ type: String, required: true })
  tokenEndpoint: string

  @Prop({ type: String, default: '' })
  userInfoEndpoint: string

  @Prop({ type: String, default: '' })
  jwksUri: string

  @Prop({ type: String, default: '' })
  issuer: string

  @Prop({ type: [String], default: [] })
  scopes: string[]

  @Prop({ type: Object, default: {} })
  extraAuthParams: Record<string, string>

  @Prop({ type: String, default: '' })
  subjectField: string

  @Prop({ type: String, default: '' })
  emailField: string

  @Prop({ type: String, default: '' })
  nameField: string

  @Prop({ type: String, default: '' })
  avatarField: string
}

@Schema({ _id: false })
export class EnterpriseSsoSamlAttributeMap {
  @Prop({ type: String, default: '' })
  subject: string

  @Prop({ type: String, default: '' })
  email: string

  @Prop({ type: String, default: '' })
  name: string

  @Prop({ type: String, default: '' })
  avatar: string
}

@Schema({ _id: false })
export class EnterpriseSsoSamlConfig {
  @Prop({ type: String, required: true })
  ssoUrl: string

  @Prop({ type: String, required: true })
  issuer: string

  @Prop({ type: String, required: true })
  audience: string

  @Prop({ type: String, required: true })
  certificate: string

  @Prop({ type: String, default: '' })
  entityId: string

  @Prop({ type: EnterpriseSsoSamlAttributeMap, default: () => ({}) })
  attributeMap: EnterpriseSsoSamlAttributeMap
}

@Schema({ ...DEFAULT_SCHEMA_OPTIONS, collection: 'enterprise_sso_providers' })
export class EnterpriseSsoProvider extends WithTimestampSchema {
  @Prop({ type: MongooseSchema.Types.ObjectId, auto: true })
  _id: MongooseSchema.Types.ObjectId

  @Prop({ type: String, required: true, unique: true, index: true })
  providerId: string

  @Prop({ type: String, required: true, index: true })
  orgId: string

  @Prop({ type: String, required: true })
  name: string

  @Prop({
    type: String,
    enum: Object.values(EnterpriseSsoProviderType),
    required: true,
    index: true,
  })
  providerType: EnterpriseSsoProviderType

  @Prop({
    type: String,
    enum: Object.values(EnterpriseSsoProtocol),
    required: true,
    index: true,
  })
  protocol: EnterpriseSsoProtocol

  @Prop({ type: Boolean, default: true, index: true })
  isActive: boolean

  @Prop({
    type: String,
    enum: USER_ROLE_STORAGE_VALUES,
    default: UserRole.EMPLOYEE,
  })
  defaultRole: UserRole

  @Prop({ type: [String], default: [] })
  allowedDomains: string[]

  @Prop({ type: Boolean, default: true })
  autoProvision: boolean

  @Prop({ type: EnterpriseSsoOidcConfig, default: null })
  oidc: EnterpriseSsoOidcConfig | null

  @Prop({ type: EnterpriseSsoSamlConfig, default: null })
  saml: EnterpriseSsoSamlConfig | null

  @Prop({ type: String, default: '' })
  createdByUserId: string

  @Prop({ type: String, default: '' })
  updatedByUserId: string

  @Prop({ type: Date, default: null })
  lastLoginAt: Date | null
}

export const EnterpriseSsoProviderSchema = SchemaFactory.createForClass(EnterpriseSsoProvider)

EnterpriseSsoProviderSchema.index({ orgId: 1, isActive: 1, createdAt: -1 })
EnterpriseSsoProviderSchema.index({ orgId: 1, providerType: 1, createdAt: -1 })
