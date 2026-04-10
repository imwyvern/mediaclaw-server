import {
  EnterpriseSsoProtocol,
  EnterpriseSsoProviderType,
  UserRole,
} from '@yikart/mongodb'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator'

export class EnterpriseSsoOidcConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  clientId: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  clientSecret: string

  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  authorizationEndpoint: string

  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  tokenEndpoint: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  userInfoEndpoint?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  jwksUri?: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  issuer?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  scopes?: string[]

  @IsOptional()
  @IsObject()
  extraAuthParams?: Record<string, string>

  @IsOptional()
  @IsString()
  @MaxLength(128)
  subjectField?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  emailField?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  nameField?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  avatarField?: string
}

export class EnterpriseSsoSamlConfigDto {
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  ssoUrl: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  issuer: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  audience: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(16384)
  certificate: string

  @IsOptional()
  @IsString()
  @MaxLength(512)
  entityId?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  subjectAttribute?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  emailAttribute?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  nameAttribute?: string

  @IsOptional()
  @IsString()
  @MaxLength(256)
  avatarAttribute?: string
}

export class CreateEnterpriseSsoProviderDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  name: string

  @IsEnum(EnterpriseSsoProviderType)
  providerType: EnterpriseSsoProviderType

  @IsOptional()
  @IsEnum(EnterpriseSsoProtocol)
  protocol?: EnterpriseSsoProtocol

  @IsOptional()
  @IsBoolean()
  autoProvision?: boolean

  @IsOptional()
  @IsBoolean()
  isActive?: boolean

  @IsOptional()
  @IsEnum(UserRole)
  defaultRole?: UserRole

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedDomains?: string[]

  @IsOptional()
  @ValidateNested()
  @Type(() => EnterpriseSsoOidcConfigDto)
  oidc?: EnterpriseSsoOidcConfigDto

  @IsOptional()
  @ValidateNested()
  @Type(() => EnterpriseSsoSamlConfigDto)
  saml?: EnterpriseSsoSamlConfigDto
}

export class EnterpriseSsoLoginUrlQueryDto {
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  callbackUrl?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2048)
  returnUrl?: string
}

export class EnterpriseSsoCallbackQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  code: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  state: string
}

export class EnterpriseSsoSamlAssertionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200000)
  samlResponse: string

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  relayState?: string

  @IsOptional()
  @IsString()
  @MaxLength(128)
  providerId?: string
}
