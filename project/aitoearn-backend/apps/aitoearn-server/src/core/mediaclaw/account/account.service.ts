import { Injectable, NotFoundException } from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import { MediaClawUser, PackStatus, VideoPack, VideoTask, VideoTaskStatus } from '@yikart/mongodb'
import { Model } from 'mongoose'
import { MEDIACLAW_SUCCESS_STATUSES } from '../video-task-status.utils'

@Injectable()
export class McAccountService {
  constructor(
    @InjectModel(MediaClawUser.name) private readonly userModel: Model<MediaClawUser>,
    @InjectModel(VideoPack.name) private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(VideoTask.name) private readonly videoTaskModel: Model<VideoTask>,
  ) {}

  /**
   * Get user account info
   */
  async getInfo(userId: string) {
    const user = await this.userModel.findById(userId).exec()
    if (!user)
      throw new NotFoundException('User not found')

    return {
      id: user._id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
      orgId: user.orgId,
      role: user.role,
      userType: user.userType,
      imBindings: user.imBindings,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    }
  }

  /**
   * Get usage statistics
   */
  async getUsage(userId: string) {
    const now = new Date()

    const [activePacks, totalTasks, completedTasks, failedTasks] = await Promise.all([
      this.videoPackModel.find({
        userId,
        status: PackStatus.ACTIVE,
        $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
      }).exec(),

      this.videoTaskModel.countDocuments({ userId }),
      this.videoTaskModel.countDocuments({
        userId,
        status: { $in: MEDIACLAW_SUCCESS_STATUSES },
      }),
      this.videoTaskModel.countDocuments({ userId, status: VideoTaskStatus.FAILED }),
    ])

    const totalCredits = activePacks.reduce((sum, p) => sum + p.remainingCredits, 0)

    return {
      credits: {
        remaining: totalCredits,
        packs: activePacks.map(p => ({
          type: p.packType,
          remaining: p.remainingCredits,
          total: p.totalCredits,
          expiresAt: p.expiresAt,
        })),
      },
      videos: {
        total: totalTasks,
        completed: completedTasks,
        failed: failedTasks,
        successRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
      },
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(userId: string, data: { name?: string, avatarUrl?: string, email?: string }) {
    return this.userModel.findByIdAndUpdate(userId, data, { new: true }).exec()
  }
}
