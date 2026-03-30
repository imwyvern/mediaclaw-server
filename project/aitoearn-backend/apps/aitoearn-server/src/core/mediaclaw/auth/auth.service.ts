import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { InjectModel } from '@nestjs/mongoose'
import { McUserType, MediaClawUser, UserRole, VideoPack } from '@yikart/mongodb'
import { Model } from 'mongoose'

@Injectable()
export class McAuthService {
  private readonly logger = new Logger(McAuthService.name)

  // In-memory OTP store (TODO: move to Redis for production)
  private otpStore = new Map<string, { code: string, expiresAt: number }>()

  constructor(
    @InjectModel(MediaClawUser.name) private readonly userModel: Model<MediaClawUser>,
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    private readonly jwtService: JwtService,
  ) {}

  validatePhoneNumber(phone: string) {
    if (!/^1\d{10}$/.test(phone)) {
      throw new BadRequestException('Invalid phone number')
    }
  }

  /**
   * Send SMS verification code
   */
  async sendSmsCode(phone: string) {
    this.validatePhoneNumber(phone)

    // Rate limit: 1 code per 60s
    const existing = this.otpStore.get(phone)
    if (existing && existing.expiresAt - Date.now() > 4 * 60 * 1000) {
      throw new BadRequestException('Please wait before requesting another code')
    }

    const code = Math.random().toString().slice(2, 8)
    this.otpStore.set(phone, {
      code,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 min expiry
    })

    // TODO: Integrate with AliSms service for real SMS
    this.logger.log(`[DEV] SMS code for ${phone}: ${code}`)

    return { success: true, message: 'Code sent' }
  }

  async consumeSmsCode(phone: string, code: string) {
    const stored = this.otpStore.get(phone)
    if (!stored || stored.code !== code || stored.expiresAt < Date.now()) {
      throw new BadRequestException('Invalid or expired verification code')
    }

    this.otpStore.delete(phone)
  }

  /**
   * Verify SMS code and login/register
   */
  async verifySmsCode(phone: string, code: string) {
    await this.consumeSmsCode(phone, code)

    // Find or create user
    let user = await this.userModel.findOne({ phone }).exec()
    let isNewUser = false

    if (!user) {
      isNewUser = true
      user = await this.userModel.create({
        phone,
        name: `用户${phone.slice(-4)}`,
        role: UserRole.ADMIN, // First user = admin of their own account
        userType: McUserType.INDIVIDUAL,
        orgMemberships: [],
        isActive: true,
        lastLoginAt: new Date(),
      })

      // Create trial pack (1 free video)
      await this.videoPackModel.create({
        userId: user._id.toString(),
        packType: 'trial_free',
        totalCredits: 1,
        remainingCredits: 1,
        priceCents: 0,
        status: 'active',
        purchasedAt: new Date(),
        expiresAt: null,
      })

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

  /**
   * WeChat OAuth callback
   */
  async wechatCallback(_code: string) {
    // TODO: Implement WeChat OAuth flow
    // 1. Exchange code for access_token + openid
    // 2. Get user info
    // 3. Find or create user by IM binding
    // 4. Generate JWT
    throw new BadRequestException('WeChat OAuth not yet implemented')
  }

  /**
   * Refresh access token
   */
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
      role: user.role,
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
      role: user.role,
      orgId: user.orgId,
      userType: user.userType,
      avatarUrl: user.avatarUrl,
    }
  }
}
