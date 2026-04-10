import { createHash } from 'node:crypto'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  ClawHostInstance,
  ClawHostInstanceStatus,
  McUserType,
  MediaClawUser,
  PackStatus,
  VideoPack,
} from '@yikart/mongodb'
import { Model } from 'mongoose'

interface SharedExperienceChannel {
  channel: string
  groupName: string
  inviteUrl: string
  chatId: string
  entryKeyword: string
  isDefault: boolean
}

@Injectable()
export class PersonalSharedExperienceService {
  constructor(
    @InjectModel(MediaClawUser.name)
    private readonly userModel: Model<MediaClawUser>,
    @InjectModel(VideoPack.name)
    private readonly videoPackModel: Model<VideoPack>,
    @InjectModel(ClawHostInstance.name)
    private readonly clawHostInstanceModel: Model<ClawHostInstance>,
  ) {}

  async getCatalog() {
    const instances = await this.listActiveSharedInstances()

    return {
      enabled: instances.length > 0,
      total: instances.length,
      items: instances.map(instance => this.toExperienceEntry(instance)),
    }
  }

  async getMyEntry(userId: string) {
    const user = await this.getIndividualUser(userId)
    const instances = await this.listActiveSharedInstances()
    const balance = await this.buildBalanceSummary(userId)
    const activeInstance = this.resolveBoundInstance(instances, user.sharedExperience?.instanceId || '')
      || instances[0]
      || null

    return {
      enabled: Boolean(activeInstance),
      user: this.toUserSummary(user),
      balance,
      activation: this.toActivationSummary(user, activeInstance),
      entry: activeInstance ? this.toExperienceEntry(activeInstance, user.sharedExperience?.channel || '') : null,
      availableEntries: instances.map(instance =>
        this.toExperienceEntry(
          instance,
          instance.instanceId === user.sharedExperience?.instanceId ? user.sharedExperience?.channel || '' : '',
        )),
    }
  }

  async activate(userId: string, input: { instanceId?: string, preferredChannel?: string }) {
    const user = await this.getIndividualUser(userId)
    const instance = await this.resolveActiveInstance(input.instanceId)
    const selectedChannel = this.resolveSelectedChannel(
      instance.sharedExperienceConfig?.channels || [],
      input.preferredChannel?.trim() || '',
      instance.sharedExperienceConfig?.defaultChannel || '',
    )

    if (!selectedChannel) {
      throw new BadRequestException('shared experience channel is not available')
    }

    const now = new Date()
    const existingBinding = user.sharedExperience || {
      instanceId: '',
      sessionId: '',
      channel: '',
      activatedAt: null,
      lastAccessAt: null,
    }
    const sessionId = (
      existingBinding.instanceId === instance.instanceId
      && existingBinding.sessionId?.trim()
    )
      ? existingBinding.sessionId.trim()
      : this.buildSessionId(user._id?.toString?.() || userId, instance.instanceId)
    const activatedAt = existingBinding.activatedAt || now

    await this.userModel.updateOne(
      { _id: user._id },
      {
        $set: {
          sharedExperience: {
            instanceId: instance.instanceId,
            sessionId,
            channel: selectedChannel.channel,
            activatedAt,
            lastAccessAt: now,
          },
        },
      },
    ).exec()

    await this.clawHostInstanceModel.updateOne(
      { _id: instance._id },
      {
        $set: {
          'sharedExperienceConfig.lastActivatedAt': now,
        },
      },
    ).exec()

    return {
      activated: true,
      user: this.toUserSummary(user),
      balance: await this.buildBalanceSummary(userId),
      activation: {
        instanceId: instance.instanceId,
        sessionId,
        channel: selectedChannel.channel,
        activatedAt,
        lastAccessAt: now,
      },
      entry: this.toExperienceEntry(instance, selectedChannel.channel),
    }
  }

  private async getIndividualUser(userId: string) {
    const user = await this.userModel.findById(userId).lean().exec()
    if (!user) {
      throw new NotFoundException('user not found')
    }

    if (user.userType !== McUserType.INDIVIDUAL) {
      throw new BadRequestException('shared experience is only available for individual users')
    }

    return user
  }

  private async listActiveSharedInstances() {
    return this.clawHostInstanceModel.find({
      'status': ClawHostInstanceStatus.RUNNING,
      'sharedExperienceConfig.enabled': true,
    })
      .sort({ 'sharedExperienceConfig.lastActivatedAt': -1, 'createdAt': -1 })
      .lean()
      .exec()
  }

  private async resolveActiveInstance(instanceId?: string) {
    const normalizedInstanceId = instanceId?.trim()
    const query = normalizedInstanceId
      ? {
          'instanceId': normalizedInstanceId,
          'status': ClawHostInstanceStatus.RUNNING,
          'sharedExperienceConfig.enabled': true,
        }
      : {
          'status': ClawHostInstanceStatus.RUNNING,
          'sharedExperienceConfig.enabled': true,
        }

    const instance = normalizedInstanceId
      ? await this.clawHostInstanceModel.findOne(query).lean().exec()
      : await this.clawHostInstanceModel.find(query).sort({
          'sharedExperienceConfig.lastActivatedAt': -1,
          'createdAt': -1,
        }).limit(1).lean().exec().then(items => items[0] || null)

    if (!instance) {
      throw new NotFoundException('shared experience instance not configured')
    }

    return instance
  }

  private resolveBoundInstance(instances: ClawHostInstance[], instanceId: string) {
    const normalizedInstanceId = instanceId?.trim()
    if (!normalizedInstanceId) {
      return null
    }

    return instances.find(instance => instance.instanceId === normalizedInstanceId) || null
  }

  private async buildBalanceSummary(userId: string) {
    const packs = await this.videoPackModel.find({
      userId,
      status: PackStatus.ACTIVE,
    }).lean().exec()

    const totalRemainingCredits = packs.reduce(
      (sum, pack) => sum + Number(pack.remainingCredits || 0),
      0,
    )
    const trialPack = packs.find(pack => pack.packType === 'trial_free')

    return {
      activePackCount: packs.length,
      totalRemainingCredits,
      trialRemainingCredits: Number(trialPack?.remainingCredits || 0),
      latestExpiresAt: packs
        .map(pack => pack.expiresAt)
        .filter(Boolean)
        .sort((left, right) => new Date(right as Date).getTime() - new Date(left as Date).getTime())[0] || null,
    }
  }

  private toUserSummary(user: Pick<MediaClawUser, '_id' | 'phone' | 'name' | 'userType'>) {
    return {
      id: user._id?.toString?.() || '',
      phone: user.phone || '',
      name: user.name || '',
      userType: user.userType,
    }
  }

  private toActivationSummary(
    user: Pick<MediaClawUser, 'sharedExperience'>,
    instance: ClawHostInstance | null,
  ) {
    const binding = user.sharedExperience
    if (!binding?.instanceId || !instance || binding.instanceId !== instance.instanceId) {
      return {
        activated: false,
        instanceId: '',
        sessionId: '',
        channel: '',
        activatedAt: null,
        lastAccessAt: null,
      }
    }

    return {
      activated: true,
      instanceId: binding.instanceId,
      sessionId: binding.sessionId || '',
      channel: binding.channel || '',
      activatedAt: binding.activatedAt || null,
      lastAccessAt: binding.lastAccessAt || null,
    }
  }

  private toExperienceEntry(instance: ClawHostInstance, selectedChannel = '') {
    const channels = this.normalizeChannels(
      instance.sharedExperienceConfig?.channels || [],
      selectedChannel,
      instance.sharedExperienceConfig?.defaultChannel || '',
    )
    const currentChannel = channels.find(channel => channel.channel === selectedChannel)
      || channels.find(channel => channel.isDefault)
      || channels[0]
      || null

    return {
      instanceId: instance.instanceId,
      displayName: instance.sharedExperienceConfig?.displayName || instance.clientName,
      welcomeMessage: instance.sharedExperienceConfig?.welcomeMessage || '',
      supportContact: instance.sharedExperienceConfig?.supportContact || '',
      accessUrl: instance.accessUrl || '',
      connectionStatus: instance.status === ClawHostInstanceStatus.RUNNING ? 'running' : 'unavailable',
      channels,
      selectedChannel: currentChannel,
      nextAction: currentChannel
        ? `加入 ${currentChannel.groupName || currentChannel.channel} 后发送「${currentChannel.entryKeyword || '开始体验'}」即可继续。`
        : '当前没有可用的共享群入口。',
    }
  }

  private normalizeChannels(
    channels: Array<{
      channel: string
      groupName?: string
      inviteUrl?: string
      chatId?: string
      entryKeyword?: string
    }>,
    selectedChannel: string,
    defaultChannel: string,
  ): SharedExperienceChannel[] {
    const normalizedSelected = selectedChannel?.trim() || ''
    const normalizedDefault = defaultChannel?.trim() || ''

    return channels
      .map(channel => ({
        channel: channel.channel?.trim() || '',
        groupName: channel.groupName?.trim() || '',
        inviteUrl: channel.inviteUrl?.trim() || '',
        chatId: channel.chatId?.trim() || '',
        entryKeyword: channel.entryKeyword?.trim() || '',
      }))
      .filter(channel => channel.channel)
      .map(channel => ({
        ...channel,
        isDefault: normalizedSelected
          ? channel.channel === normalizedSelected
          : normalizedDefault
            ? channel.channel === normalizedDefault
            : false,
      }))
      .map((channel, index, items) => ({
        ...channel,
        isDefault: items.some(item => item.isDefault)
          ? channel.isDefault
          : index === 0,
      }))
  }

  private resolveSelectedChannel(
    channels: Array<{
      channel: string
      groupName?: string
      inviteUrl?: string
      chatId?: string
      entryKeyword?: string
    }>,
    requestedChannel: string,
    defaultChannel: string,
  ) {
    const normalizedChannels = this.normalizeChannels(channels, requestedChannel, defaultChannel)
    return normalizedChannels.find(channel => channel.channel === requestedChannel)
      || normalizedChannels.find(channel => channel.isDefault)
      || normalizedChannels[0]
      || null
  }

  private buildSessionId(userId: string, instanceId: string) {
    const digest = createHash('sha256')
      .update(`${userId}:${instanceId}`)
      .digest('hex')
      .slice(0, 16)

    return `mc_shared_${digest}`
  }
}
