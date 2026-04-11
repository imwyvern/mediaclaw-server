import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { InjectModel } from '@nestjs/mongoose'
import {
  DeliveryRecord,
  ImSession,
  ImSessionMessageType,
  ImSessionRole,
  ImSessionState,
  ImSessionVoteDecision,
  VideoTask,
} from '@yikart/mongodb'
import { Model } from 'mongoose'

type SessionRecord = Record<string, any>

interface SessionParticipantInput {
  memberId: string
  displayName?: string
  role?: string
  channelUserId?: string
  metadata?: Record<string, unknown>
}

interface EnsureDispatchSessionInput {
  orgId: string
  videoTaskId: string
  deliveryRecordId: string
  employeeAssignmentId?: string
  channel: string
  conversationId?: string
  title: string
  summary: string
  initialMessage: string
  participant?: SessionParticipantInput | null
}

interface SessionMessageInput {
  memberId: string
  role?: string
  content: string
}

@Injectable()
export class ImSessionService {
  constructor(
    @InjectModel(ImSession.name)
    private readonly imSessionModel: Model<ImSession>,
    @InjectModel(DeliveryRecord.name)
    private readonly deliveryRecordModel: Model<DeliveryRecord>,
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
  ) {}

  async ensureDispatchSession(input: EnsureDispatchSessionInput) {
    const now = new Date()
    const participant = input.participant
      ? [this.normalizeParticipant(input.participant, ImSessionRole.EDITOR)]
      : []
    const session = await this.imSessionModel.findOneAndUpdate(
      {
        orgId: input.orgId,
        videoTaskId: input.videoTaskId,
      },
      {
        $set: {
          deliveryRecordId: input.deliveryRecordId,
          employeeAssignmentId: input.employeeAssignmentId || '',
          channel: input.channel,
          conversationId: input.conversationId || '',
          state: ImSessionState.CREATED,
          deliverySnapshot: {
            title: input.title,
            summary: input.summary,
          },
          collaboration: {
            lastTouchedAt: now.toISOString(),
          },
        },
        $setOnInsert: {
          orgId: input.orgId,
          videoTaskId: input.videoTaskId,
          participants: participant,
          messages: [
            this.buildMessage(
              'system-init',
              participant[0]?.memberId || 'system',
              participant[0]?.role || ImSessionRole.EDITOR,
              ImSessionMessageType.CARD,
              input.initialMessage,
              {
                title: input.title,
                summary: input.summary,
              },
              now,
            ),
          ],
        },
      },
      {
        new: true,
        upsert: true,
      },
    ).lean().exec()

    await this.videoTaskModel.findByIdAndUpdate(input.videoTaskId, {
      $set: {
        'metadata.distribution.sessionId': session?._id?.toString?.() || '',
        'metadata.distribution.collaborationState': session?.['state'] || ImSessionState.CREATED,
      },
    }).exec()

    return this.toSessionResponse(session)
  }

  async getSession(orgId: string, sessionId: string) {
    const session = await this.findSessionOrFail(orgId, sessionId)
    return this.toSessionResponse(session)
  }

  async upsertParticipants(
    orgId: string,
    sessionId: string,
    participants: SessionParticipantInput[],
  ) {
    const session = await this.findSessionOrFail(orgId, sessionId)
    const participantMap = new Map<string, Record<string, unknown>>(
      (session['participants'] || []).map((item: Record<string, unknown>) => [
        String(item['memberId']),
        item,
      ]),
    )

    for (const item of participants) {
      const normalized = this.normalizeParticipant(item, ImSessionRole.READONLY)
      participantMap.set(normalized.memberId, normalized)
    }

    const mergedParticipants = Array.from(participantMap.values())
    const updated = await this.imSessionModel.findByIdAndUpdate(
      session['_id'],
      {
        $set: {
          'participants': mergedParticipants,
          'collaboration.lastTouchedAt': new Date().toISOString(),
        },
      },
      { new: true },
    ).lean().exec()

    return this.toSessionResponse(updated)
  }

  async appendMessage(orgId: string, sessionId: string, input: SessionMessageInput) {
    const session = await this.findSessionOrFail(orgId, sessionId)
    const role = this.assertMemberRole(session, input.memberId, [
      ImSessionRole.ADMIN,
      ImSessionRole.EDITOR,
      ImSessionRole.REVIEWER,
    ], input.role)
    const now = new Date()

    const updated = await this.imSessionModel.findByIdAndUpdate(
      session['_id'],
      {
        $push: {
          messages: this.buildMessage(
            `msg-${now.getTime()}`,
            input.memberId,
            role,
            ImSessionMessageType.TEXT,
            input.content,
            null,
            now,
          ),
        },
        $set: {
          'collaboration.lastTouchedAt': now.toISOString(),
        },
      },
      { new: true },
    ).lean().exec()

    return this.toSessionResponse(updated)
  }

  async startApproval(
    orgId: string,
    sessionId: string,
    memberId: string,
    requiredVotes = 1,
    hoursToExpire = 24,
  ) {
    const session = await this.findSessionOrFail(orgId, sessionId)
    const role = this.assertMemberRole(session, memberId, [
      ImSessionRole.ADMIN,
      ImSessionRole.EDITOR,
    ])
    const now = new Date()
    const expiresAt = new Date(now.getTime() + Math.max(hoursToExpire, 1) * 60 * 60 * 1000)
    const nextState = requiredVotes > 1 ? ImSessionState.VOTING : ImSessionState.REVIEWING

    const updated = await this.imSessionModel.findByIdAndUpdate(
      session['_id'],
      {
        $set: {
          'state': nextState,
          'approval': {
            requiredVotes: Math.max(requiredVotes, 1),
            votes: [],
            status: 'pending',
            startedAt: now,
            expiresAt,
            decidedAt: null,
            initiatedBy: memberId,
          },
          'collaboration.lastTouchedAt': now.toISOString(),
        },
        $push: {
          messages: this.buildMessage(
            `approval-${now.getTime()}`,
            memberId,
            role,
            ImSessionMessageType.APPROVAL,
            '已发起群内审批，请审核成员投票。',
            {
              requiredVotes: Math.max(requiredVotes, 1),
              expiresAt: expiresAt.toISOString(),
            },
            now,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    await this.syncTaskState(updated)
    return this.toSessionResponse(updated)
  }

  async submitVote(
    orgId: string,
    sessionId: string,
    memberId: string,
    decision: string,
    reason?: string,
  ) {
    const session = await this.findSessionOrFail(orgId, sessionId)
    const role = this.assertMemberRole(session, memberId, [
      ImSessionRole.ADMIN,
      ImSessionRole.REVIEWER,
    ])
    const normalizedDecision = this.normalizeVoteDecision(decision)
    if (
      session['state'] !== ImSessionState.VOTING
      && session['state'] !== ImSessionState.REVIEWING
    ) {
      throw new BadRequestException('session is not in approval flow')
    }

    const approval = this.asRecord(session['approval']) || {}
    const votes = Array.isArray(approval['votes']) ? [...approval['votes']] : []
    const nextVote = {
      memberId,
      decision: normalizedDecision,
      reason: reason?.trim() || '',
      createdAt: new Date(),
    }
    const voteIndex = votes.findIndex((item: Record<string, unknown>) => item['memberId'] === memberId)
    if (voteIndex >= 0) {
      votes[voteIndex] = nextVote
    }
    else {
      votes.push(nextVote)
    }

    const yesVotes = votes.filter((item: Record<string, unknown>) => item['decision'] === ImSessionVoteDecision.APPROVE).length
    const rejectVote = votes.find((item: Record<string, unknown>) => item['decision'] === ImSessionVoteDecision.REJECT)
    const requiredVotes = Math.max(Number(approval['requiredVotes'] || 1), 1)
    const now = new Date()
    const nextState = rejectVote
      ? ImSessionState.REJECTED
      : yesVotes >= requiredVotes
        ? ImSessionState.CONFIRMED
        : ImSessionState.VOTING

    const updated = await this.imSessionModel.findByIdAndUpdate(
      session['_id'],
      {
        $set: {
          'state': nextState,
          'approval': {
            ...approval,
            requiredVotes,
            votes,
            status: rejectVote ? 'rejected' : yesVotes >= requiredVotes ? 'approved' : 'pending',
            decidedAt: nextState === ImSessionState.VOTING ? null : now,
          },
          'collaboration.lastTouchedAt': now.toISOString(),
        },
        $push: {
          messages: this.buildMessage(
            `vote-${memberId}-${now.getTime()}`,
            memberId,
            role,
            ImSessionMessageType.APPROVAL,
            normalizedDecision === ImSessionVoteDecision.APPROVE ? '已投赞成票' : '已投否决票',
            {
              decision: normalizedDecision,
              reason: reason?.trim() || '',
              requiredVotes,
              yesVotes,
            },
            now,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    await this.syncTaskState(updated)
    return this.toSessionResponse(updated)
  }

  async markDeliveryReceived(orgId: string, deliveryRecordId: string) {
    const session = await this.imSessionModel.findOne({
      orgId,
      deliveryRecordId,
    }).lean().exec()
    if (!session) {
      return null
    }

    const now = new Date()
    const updated = await this.imSessionModel.findByIdAndUpdate(
      session['_id'],
      {
        $set: {
          'collaboration.receivedAt': now.toISOString(),
          'collaboration.lastTouchedAt': now.toISOString(),
        },
        $push: {
          messages: this.buildMessage(
            `received-${now.getTime()}`,
            'system',
            ImSessionRole.ADMIN,
            ImSessionMessageType.SYSTEM,
            '内容已被执行人确认接收。',
            null,
            now,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    return this.toSessionResponse(updated)
  }

  async markPublished(
    orgId: string,
    deliveryRecordId: string,
    publishData: {
      publishUrl?: string
      publishPlatform?: string
      publishPostId?: string
    },
  ) {
    const session = await this.imSessionModel.findOne({
      orgId,
      deliveryRecordId,
    }).lean().exec()
    if (!session) {
      return null
    }

    const now = new Date()
    const updated = await this.imSessionModel.findByIdAndUpdate(
      session['_id'],
      {
        $set: {
          'state': ImSessionState.PUBLISHED,
          'collaboration.publishedAt': now.toISOString(),
          'collaboration.publishInfo': {
            publishUrl: publishData.publishUrl || '',
            publishPlatform: publishData.publishPlatform || '',
            publishPostId: publishData.publishPostId || '',
          },
          'collaboration.lastTouchedAt': now.toISOString(),
        },
        $push: {
          messages: this.buildMessage(
            `published-${now.getTime()}`,
            'system',
            ImSessionRole.ADMIN,
            ImSessionMessageType.REPORT,
            '内容已确认发布。',
            {
              publishUrl: publishData.publishUrl || '',
              publishPlatform: publishData.publishPlatform || '',
              publishPostId: publishData.publishPostId || '',
            },
            now,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    await this.syncTaskState(updated)
    return this.toSessionResponse(updated)
  }

  async markExpired(orgId: string, deliveryRecordId: string, reason: string) {
    const session = await this.imSessionModel.findOne({
      orgId,
      deliveryRecordId,
    }).lean().exec()
    if (!session) {
      return null
    }

    const now = new Date()
    const updated = await this.imSessionModel.findByIdAndUpdate(
      session['_id'],
      {
        $set: {
          'state': ImSessionState.EXPIRED,
          'collaboration.expiredAt': now.toISOString(),
          'collaboration.expireReason': reason,
          'collaboration.lastTouchedAt': now.toISOString(),
        },
        $push: {
          messages: this.buildMessage(
            `expired-${now.getTime()}`,
            'system',
            ImSessionRole.ADMIN,
            ImSessionMessageType.SYSTEM,
            '协作会话已过期。',
            { reason },
            now,
          ),
        },
      },
      { new: true },
    ).lean().exec()

    await this.syncTaskState(updated)
    return this.toSessionResponse(updated)
  }

  async validateConsistency() {
    const sessions = await this.imSessionModel.find({}).lean().exec()
    let repaired = 0

    for (const session of sessions as SessionRecord[]) {
      const record = await this.deliveryRecordModel.findOne({
        orgId: session['orgId'],
        videoTaskId: session['videoTaskId'],
      }).lean().exec()

      if (!record || record['_id']?.toString?.() === session['deliveryRecordId']) {
        continue
      }

      await this.imSessionModel.findByIdAndUpdate(session['_id'], {
        $set: {
          'deliveryRecordId': record['_id'].toString(),
          'collaboration.lastRepairedAt': new Date().toISOString(),
        },
      }).exec()
      repaired += 1
    }

    return {
      scanned: sessions.length,
      repaired,
    }
  }

  private async syncTaskState(session: SessionRecord | null) {
    if (!session) {
      return
    }

    await this.videoTaskModel.findByIdAndUpdate(session['videoTaskId'], {
      $set: {
        'metadata.distribution.sessionId': session['_id']?.toString?.() || '',
        'metadata.distribution.collaborationState': session['state'] || ImSessionState.CREATED,
        'metadata.distribution.collaboration': this.asRecord(session['collaboration']) || {},
      },
    }).exec()
  }

  private async findSessionOrFail(orgId: string, sessionId: string) {
    const session = await this.imSessionModel.findOne({
      _id: sessionId,
      orgId,
    }).lean().exec()
    if (!session) {
      throw new NotFoundException('dispatch session not found')
    }
    return session as SessionRecord
  }

  private normalizeParticipant(input: SessionParticipantInput, fallbackRole: ImSessionRole) {
    const memberId = input.memberId?.trim()
    if (!memberId) {
      throw new BadRequestException('memberId is required')
    }

    return {
      memberId,
      displayName: input.displayName?.trim() || '',
      role: this.normalizeRole(input.role, fallbackRole),
      channelUserId: input.channelUserId?.trim() || '',
      metadata: input.metadata || null,
      joinedAt: new Date(),
    }
  }

  private buildMessage(
    messageId: string,
    authorId: string,
    authorRole: ImSessionRole,
    type: ImSessionMessageType,
    content: string,
    metadata: Record<string, unknown> | null,
    createdAt: Date,
  ) {
    return {
      messageId,
      authorId,
      authorRole,
      type,
      content,
      createdAt,
      metadata,
    }
  }

  private assertMemberRole(
    session: SessionRecord,
    memberId: string,
    allowedRoles: ImSessionRole[],
    roleHint?: string,
  ) {
    const normalizedMemberId = memberId?.trim()
    if (!normalizedMemberId) {
      throw new BadRequestException('memberId is required')
    }

    const participant = Array.isArray(session['participants'])
      ? session['participants'].find((item: Record<string, unknown>) => item['memberId'] === normalizedMemberId)
      : null
    const resolvedRole = this.normalizeRole(
      participant?.['role'] as string | undefined || roleHint,
      ImSessionRole.READONLY,
    )
    if (!allowedRoles.includes(resolvedRole)) {
      throw new BadRequestException('member role is not allowed for this action')
    }
    return resolvedRole
  }

  private normalizeRole(value: string | undefined, fallbackRole: ImSessionRole) {
    const normalized = value?.trim().toLowerCase() || fallbackRole
    const allowed = Object.values(ImSessionRole)
    if (!allowed.includes(normalized as ImSessionRole)) {
      return fallbackRole
    }
    return normalized as ImSessionRole
  }

  private normalizeVoteDecision(value: string) {
    const normalized = value?.trim().toLowerCase()
    if (normalized !== ImSessionVoteDecision.APPROVE && normalized !== ImSessionVoteDecision.REJECT) {
      throw new BadRequestException('decision must be approve or reject')
    }
    return normalized
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object'
      ? value as Record<string, unknown>
      : null
  }

  private toSessionResponse(session: SessionRecord | null) {
    if (!session) {
      return null
    }

    return {
      id: session['_id']?.toString?.() || '',
      orgId: session['orgId'] || '',
      videoTaskId: session['videoTaskId'] || '',
      deliveryRecordId: session['deliveryRecordId'] || '',
      employeeAssignmentId: session['employeeAssignmentId'] || '',
      channel: session['channel'] || '',
      conversationId: session['conversationId'] || '',
      state: session['state'] || ImSessionState.CREATED,
      participants: session['participants'] || [],
      messages: session['messages'] || [],
      approval: session['approval'] || null,
      collaboration: session['collaboration'] || null,
      deliverySnapshot: session['deliverySnapshot'] || null,
      createdAt: session['createdAt'] || null,
      updatedAt: session['updatedAt'] || null,
    }
  }
}
