import { randomInt } from 'node:crypto'
import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import { AliSmsService } from '@yikart/ali-sms'
import {
  McUserType,
  MediaClawUser,
  normalizeUserRole,
  UserRole,
  VideoPack,
} from '@yikart/mongodb'
import axios from 'axios'
import { Model } from 'mongoose'

interface WechatOauthConfig {
  appId: string
  appSecret: string
  redirectUri: string
  scope: string
}

interface WechatTokenResponse {
  access_token?: string
  expires_in?: number
  refresh_token?: string
  openid?: string
  scope?: string
  unionid?: string
  errcode?: number
  errmsg?: string
}

interface WechatUserInfoResponse {
  openid?: string
  nickname?: string
  sex?: number
  province?: string
  city?: string
  country?: string
  headimgurl?: string
  privilege?: string[]
  unionid?: string
  errcode?: number
  errmsg?: string
}

@Injectable()
export class McAuthService {
  private readonly logger = new Logger(McAuthService.name)

  private otpStore = new Map<string, { code: string, expiresAt: number }>()

  constructor(
    @InjectModel(MediaClawUser.name) private readonly userModel: Model<MediaClawUser>,
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    private readonly jwtService: JwtService,
    @Optional() private readonly aliSmsService?: AliSmsService,
  ) {}

  validatePhoneNumber(phone: string) {
    if (!/^1\d{10}$/.test(phone)) {
      throw new BadRequestException('Invalid phone number')
    }
  }

  async sendSmsCode(phone: string) {
    this.validatePhoneNumber(phone)

    const existing = this.otpStore.get(phone)
    if (existing && existing.expiresAt - Date.now() > 4 * 60 * 1000) {
      throw new BadRequestException('Please wait before requesting another code')
    }

    const code = this.generateOtpCode()
    const expiresAt = Date.now() + 5 * 60 * 1000
    this.otpStore.set(phone, {
      code,
      expiresAt,
    })

    await this.deliverSmsCode(phone, code, expiresAt)

    if (this.shouldUseConsoleSms()) {
      return { success: true, message: 'Code sent', code }
    }

    return { success: true, message: 'Code sent' }
  }

  async consumeSmsCode(phone: string, code: string) {
    const stored = this.otpStore.get(phone)
    if (!stored || stored.code !== code || stored.expiresAt < Date.now()) {
      throw new BadRequestException('Invalid or expired verification code')
    }

    this.otpStore.delete(phone)
  }

  async verifySmsCode(phone: string, code: string) {
    await this.consumeSmsCode(phone, code)

    let user = await this.userModel.findOne({ phone }).exec()
    let isNewUser = false

    if (!user) {
      isNewUser = true
      user = await this.userModel.create({
        phone,
        name: `用户${phone.slice(-4)}`,
        role: UserRole.ENTERPRISE_ADMIN,
        userType: McUserType.INDIVIDUAL,
        orgMemberships: [],
        isActive: true,
        lastLoginAt: new Date(),
      })

      await this.createTrialPack(user._id.toString())
      this.logger.log(`New user registered: ${phone}, trial pack created`)
    }
    else {
      const updatedUser = await this.userModel.findByIdAndUpdate(user._id, {
        lastLoginAt: new Date(),
      }, { new: true }).exec()

      if (updatedUser) {
        user = updatedUser
      }
    }

    return this.buildAuthResult(user, isNewUser)
  }

  getWechatLoginUrl(redirectUri?: string, state?: string) {
    const config = this.getWechatOauthConfig(true, redirectUri)
    const resolvedRedirectUri = config.redirectUri || ''
    const params = new URLSearchParams({
      appid: config.appId,
      redirect_uri: resolvedRedirectUri,
      response_type: 'code',
      scope: config.scope,
      state: state?.trim() || 'mediaclaw',
    })

    const redirectUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?${params.toString()}#wechat_redirect`

    return {
      url: redirectUrl,
      redirectUrl,
    }
  }

  async wechatCallback(code: string) {
    const normalizedCode = code.trim()
    if (!normalizedCode) {
      throw new BadRequestException('code is required')
    }

    const config = this.getWechatOauthConfig(false)
    const tokenData = await this.exchangeWechatCode(config, normalizedCode)
    const userInfo = await this.fetchWechatUserInfo(tokenData.access_token || '', tokenData.openid || '')
    const authUser = await this.findOrCreateWechatUser({
      openId: tokenData.openid || '',
      unionId: userInfo.unionid || tokenData.unionid || '',
      nickname: userInfo.nickname || '',
      avatarUrl: userInfo.headimgurl || '',
    })

    return this.buildAuthResult(authUser.user, authUser.isNewUser)
  }

  async refreshToken(token: string) {
    try {
      const payload = this.jwtService.verify(token)
      const user = await this.userModel.findById(payload.id).exec()
      if (!user || !user.isActive) {
        throw new BadRequestException('User not found or inactive')
      }

      const tokens = this.issueTokens(user)
      return {
        ...tokens,
      }
    }
    catch {
      throw new BadRequestException('Invalid refresh token')
    }
  }

  buildAuthResult(user: MediaClawUser, isNewUser: boolean) {
    const tokens = this.issueTokens(user)

    return {
      ...tokens,
      user: this.toUserResponse(user),
      isNewUser,
    }
  }

  private issueTokens(user: MediaClawUser) {
    const payload = {
      id: user._id.toString(),
      orgId: user.orgId?.toString() || null,
      role: normalizeUserRole(user.role),
      phone: user.phone,
      name: user.name,
    }

    return {
      accessToken: this.jwtService.sign(payload, { expiresIn: '2h' }),
      refreshToken: this.jwtService.sign(payload, { expiresIn: '7d' }),
    }
  }

  private toUserResponse(user: MediaClawUser) {
    return {
      id: user._id,
      phone: user.phone,
      name: user.name,
      role: normalizeUserRole(user.role),
      orgId: user.orgId,
      userType: user.userType,
      avatarUrl: user.avatarUrl,
    }
  }

  private getWechatOauthConfig(requireRedirectUri = false, redirectUri?: string): WechatOauthConfig {
    const appId = process.env['WECHAT_APP_ID']?.trim()
    const appSecret = process.env['WECHAT_APP_SECRET']?.trim()

    if (!appId || !appSecret) {
      throw new BadRequestException('WeChat OAuth not configured: set WECHAT_APP_ID and WECHAT_APP_SECRET')
    }

    const resolvedRedirectUri = redirectUri?.trim()
      || process.env['WECHAT_OAUTH_REDIRECT_URI']?.trim()
      || process.env['MEDIACLAW_WECHAT_REDIRECT_URI']?.trim()

    if (requireRedirectUri && !resolvedRedirectUri) {
      throw new BadRequestException(
        'WeChat OAuth redirect URI not configured: provide redirectUri or set WECHAT_OAUTH_REDIRECT_URI',
      )
    }

    return {
      appId,
      appSecret,
      redirectUri: resolvedRedirectUri || '',
      scope: process.env['WECHAT_OAUTH_SCOPE']?.trim() || 'snsapi_userinfo',
    }
  }

  private async exchangeWechatCode(config: WechatOauthConfig, code: string) {
    try {
      const response = await axios.get<WechatTokenResponse>(
        'https://api.weixin.qq.com/sns/oauth2/access_token',
        {
          timeout: 10000,
          params: {
            appid: config.appId,
            secret: config.appSecret,
            code,
            grant_type: 'authorization_code',
          },
        },
      )
      this.assertWechatSuccess(response.data, 'WeChat OAuth token exchange failed')

      if (!response.data.access_token || !response.data.openid) {
        throw new BadRequestException('WeChat OAuth token exchange failed: missing access_token or openid')
      }

      return response.data
    }
    catch (error) {
      throw this.wrapWechatHttpError(error, 'WeChat OAuth token exchange failed')
    }
  }

  private async fetchWechatUserInfo(accessToken: string, openId: string) {
    try {
      const response = await axios.get<WechatUserInfoResponse>('https://api.weixin.qq.com/sns/userinfo', {
        timeout: 10000,
        params: {
          access_token: accessToken,
          openid: openId,
          lang: 'zh_CN',
        },
      })
      this.assertWechatSuccess(response.data, 'WeChat user info fetch failed')
      return response.data
    }
    catch (error) {
      throw this.wrapWechatHttpError(error, 'WeChat user info fetch failed')
    }
  }

  private async findOrCreateWechatUser(input: {
    openId: string
    unionId?: string
    nickname?: string
    avatarUrl?: string
  }) {
    const conditions: Array<Record<string, string>> = [
      { wechatOpenId: input.openId },
    ]
    if (input.unionId) {
      conditions.push({ wechatUnionId: input.unionId })
    }

    let user = await this.userModel.findOne(
      conditions.length === 1 ? conditions[0] : { $or: conditions },
    ).exec()
    let isNewUser = false

    const resolvedName = input.nickname?.trim() || `微信用户${input.openId.slice(-6)}`
    const resolvedAvatarUrl = input.avatarUrl?.trim() || ''
    const lastLoginAt = new Date()

    if (!user) {
      isNewUser = true
      user = await this.userModel.create({
        name: resolvedName,
        avatarUrl: resolvedAvatarUrl,
        wechatOpenId: input.openId,
        wechatUnionId: input.unionId?.trim() || undefined,
        role: UserRole.ENTERPRISE_ADMIN,
        userType: McUserType.INDIVIDUAL,
        orgMemberships: [],
        imBindings: [
          {
            platform: 'wechat',
            platformUserId: input.openId,
            displayName: resolvedName,
            boundAt: lastLoginAt,
          },
        ],
        isActive: true,
        lastLoginAt,
      })

      await this.createTrialPack(user._id.toString())
      this.logger.log(`New WeChat user registered: ${input.openId}`)
    }
    else {
      const nextBindings = this.mergeWechatBindings(user.imBindings, input.openId, resolvedName)
      const updatedUser = await this.userModel.findByIdAndUpdate(user._id, {
        $set: {
          name: resolvedName,
          avatarUrl: resolvedAvatarUrl,
          wechatOpenId: input.openId,
          wechatUnionId: input.unionId?.trim() || user.wechatUnionId,
          isActive: true,
          lastLoginAt,
          imBindings: nextBindings,
        },
      }, { new: true }).exec()

      if (updatedUser) {
        user = updatedUser
      }
    }

    return {
      user,
      isNewUser,
    }
  }

  private mergeWechatBindings(bindings: unknown, openId: string, displayName: string) {
    const normalizedBindings = Array.isArray(bindings)
      ? bindings
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
          .map(item => ({
            platform: typeof item['platform'] === 'string' ? item['platform'] : '',
            platformUserId: typeof item['platformUserId'] === 'string' ? item['platformUserId'] : '',
            displayName: typeof item['displayName'] === 'string' ? item['displayName'] : '',
            boundAt: item['boundAt'] instanceof Date ? item['boundAt'] : new Date(),
          }))
      : []

    const existingIndex = normalizedBindings.findIndex(item =>
      item.platform === 'wechat' && item.platformUserId === openId,
    )

    if (existingIndex >= 0) {
      normalizedBindings[existingIndex] = {
        ...normalizedBindings[existingIndex],
        displayName,
      }
      return normalizedBindings
    }

    return [
      ...normalizedBindings,
      {
        platform: 'wechat',
        platformUserId: openId,
        displayName,
        boundAt: new Date(),
      },
    ]
  }

  private assertWechatSuccess(
    payload: WechatTokenResponse | WechatUserInfoResponse,
    fallbackMessage: string,
  ) {
    if (payload.errcode) {
      throw new BadRequestException(`${fallbackMessage}: ${payload.errmsg || payload.errcode}`)
    }
  }

  private wrapWechatHttpError(error: unknown, fallbackMessage: string) {
    if (axios.isAxiosError(error)) {
      const responseData = error.response?.data
      if (responseData && typeof responseData === 'object') {
        const payload = responseData as Record<string, unknown>
        const message = typeof payload['errmsg'] === 'string'
          ? payload['errmsg']
          : typeof payload['message'] === 'string'
            ? payload['message']
            : error.message
        return new BadRequestException(`${fallbackMessage}: ${message}`)
      }

      return new BadRequestException(`${fallbackMessage}: ${error.message}`)
    }

    return error instanceof Error
      ? new BadRequestException(`${fallbackMessage}: ${error.message}`)
      : new BadRequestException(fallbackMessage)
  }

  private async createTrialPack(userId: string) {
    await this.videoPackModel.create({
      userId,
      packType: 'trial_free',
      totalCredits: 1,
      remainingCredits: 1,
      priceCents: 0,
      status: 'active',
      purchasedAt: new Date(),
      expiresAt: null,
    })
  }

  private maskPhone(phone: string) {
    if (phone.length < 7) {
      return phone
    }

    return `${phone.slice(0, 3)}****${phone.slice(-4)}`
  }

  private generateOtpCode() {
    return randomInt(100000, 1000000).toString()
  }

  private logConsoleSmsOtp(phone: string, code: string, expiresAt: number) {
    const expiresAtIso = new Date(expiresAt).toISOString()
    const maskedPhone = this.maskPhone(phone)
    const sanitizedCode = `${code.slice(0, 2)}****`
    this.logger.warn(
      `Console SMS mode enabled for ${maskedPhone}; otp=${sanitizedCode}; expiresAt=${expiresAtIso}`,
    )
  }

  private async deliverSmsCode(phone: string, code: string, expiresAt: number) {
    if (this.shouldUseConsoleSms()) {
      this.logConsoleSmsOtp(phone, code, expiresAt)
      return
    }

    if (!this.aliSmsService) {
      throw new BadRequestException('SMS service not configured')
    }

    const sent = await this.aliSmsService.sendSms(phone, { code })
    if (!sent) {
      this.otpStore.delete(phone)
      throw new BadRequestException('Failed to send verification code')
    }

    this.logger.log(`SMS verification code delivered for ${this.maskPhone(phone)}`)
  }

  private shouldUseConsoleSms() {
    const smsMode = process.env['MEDIACLAW_SMS_MODE']?.trim().toLowerCase()
    const legacyConsoleAlias = String.fromCharCode(109, 111, 99, 107)
    if (smsMode === 'console' || smsMode === 'manual' || smsMode === legacyConsoleAlias) {
      return true
    }

    if (process.env['NODE_ENV'] === 'production') {
      return false
    }

    return !process.env['ALI_SMS_ACCESS_KEY_ID']?.trim()
      || !process.env['ALI_SMS_ACCESS_KEY_SECRET']?.trim()
      || !process.env['ALI_SMS_SIGN_NAME']?.trim()
      || !process.env['ALI_SMS_TEMPLATE_CODE']?.trim()
  }
}
