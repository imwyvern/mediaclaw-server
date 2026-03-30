import { BadRequestException, Injectable, Logger } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { JwtService } from '@nestjs/jwt'
import { Model } from 'mongoose'
import { MediaClawUser, UserRole } from '@yikart/mongodb'
import { VideoPack } from '@yikart/mongodb'

@Injectable()
export class McAuthService {
  private readonly logger = new Logger(McAuthService.name)

  // In-memory OTP store (TODO: move to Redis for production)
  private otpStore = new Map<string, { code: string; expiresAt: number }>()

  constructor(
    @InjectModel(MediaClawUser.name) private readonly userModel: Model<MediaClawUser>,
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    private readonly jwtService: JwtService,
  ) {}

  /**
   * Send SMS verification code
   */
  async sendSmsCode(phone: string) {
    if (!/^1\d{10}$/.test(phone)) {
      throw new BadRequestException('Invalid phone number')
    }

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

  /**
   * Verify SMS code and login/register
   */
  async verifySmsCode(phone: string, code: string) {
    const stored = this.otpStore.get(phone)
    if (!stored || stored.code !== code || stored.expiresAt < Date.now()) {
      throw new BadRequestException('Invalid or expired verification code')
    }

    this.otpStore.delete(phone)

    // Find or create user
    let user = await this.userModel.findOne({ phone }).exec()
    let isNewUser = false

    if (!user) {
      isNewUser = true
      user = await this.userModel.create({
        phone,
        name: `用户${phone.slice(-4)}`,
        role: UserRole.ADMIN, // First user = admin of their own account
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
    } else {
      await this.userModel.findByIdAndUpdate(user._id, {
        lastLoginAt: new Date(),
      })
    }

    // Generate JWT with orgId + role
    const payload = {
      id: user._id.toString(),
      orgId: user.orgId?.toString() || null,
      role: user.role,
      phone: user.phone,
      name: user.name,
    }

    const accessToken = this.jwtService.sign(payload, { expiresIn: '2h' })
    const refreshToken = this.jwtService.sign(payload, { expiresIn: '7d' })

    return {
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        phone: user.phone,
        name: user.name,
        role: user.role,
        orgId: user.orgId,
        avatarUrl: user.avatarUrl,
      },
      isNewUser,
    }
  }

  /**
   * WeChat OAuth callback
   */
  async wechatCallback(code: string) {
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

      const newPayload = {
        id: user._id.toString(),
        orgId: user.orgId?.toString() || null,
        role: user.role,
        phone: user.phone,
        name: user.name,
      }

      return {
        accessToken: this.jwtService.sign(newPayload, { expiresIn: '2h' }),
        refreshToken: this.jwtService.sign(newPayload, { expiresIn: '7d' }),
      }
    } catch {
      throw new BadRequestException('Invalid refresh token')
    }
  }
}
