import { InjectQueue } from "@nestjs/bullmq";
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import {
  Brand,
  NotificationEvent,
  Pipeline,
  ProductionBatch,
  ProductionBatchStatus,
  VideoTask,
  VideoTaskStatus,
  VideoTaskType,
} from "@yikart/mongodb";
import { Queue } from "bullmq";
import { Model, Types } from "mongoose";
import { BillingService } from "../billing/billing.service";
import { EmployeeDispatchService } from "../employee-dispatch/employee-dispatch.service";
import { NotificationService } from "../notification/notification.service";
import { PromptOptimizerService } from "../prompt-optimizer/prompt-optimizer.service";
import { DedupService } from "../dedup/dedup.service";
import {
  createStatusTransitionIterationEntry,
  mapVideoTaskStatusToProductionStage,
} from "../video-task-lifecycle.util";
import { UsageService } from "../usage/usage.service";
import {
  VIDEO_WORKER_QUEUE,
  VideoWorkerJobData,
} from "../worker/worker.constants";

interface CreateTaskInput {
  brandId?: string;
  pipelineId?: string;
  batchId?: string;
  taskType: VideoTaskType;
  sourceVideoUrl: string;
  source?: {
    type?: string;
    url?: string;
    videoId?: string;
  };
  metadata?: Record<string, any>;
}

interface CreateBatchInput {
  brandId?: string;
  batchName: string;
  tasks: CreateTaskInput[];
}

interface UpdateTaskStatusInput {
  outputVideoUrl?: string;
  errorMessage?: string;
  quality?: Record<string, any>;
  copy?: Record<string, any>;
  deepSynthesis?: Record<string, any>;
  step?: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class VideoService {
  private readonly logger = new Logger(VideoService.name);

  constructor(
    @InjectModel(VideoTask.name)
    private readonly videoTaskModel: Model<VideoTask>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    @InjectModel(ProductionBatch.name)
    private readonly productionBatchModel: Model<ProductionBatch>,
    private readonly usageService: UsageService,
    @Optional()
    private readonly billingService?: BillingService,
    @Optional()
    private readonly employeeDispatchService?: EmployeeDispatchService,
    @Optional()
    private readonly notificationService?: NotificationService,
    @Optional()
    private readonly promptOptimizerService?: PromptOptimizerService,
    @Optional()
    private readonly dedupService?: DedupService,
    @InjectQueue(VIDEO_WORKER_QUEUE)
    @Optional()
    private readonly videoWorkerQueue?: Queue<VideoWorkerJobData>,
  ) {}

  async createTask(
    orgIdOrUserId: string,
    userIdOrData: string | CreateTaskInput,
    maybeData?: CreateTaskInput,
  ) {
    const isLegacySignature = typeof userIdOrData !== "string";
    const orgId =
      typeof userIdOrData === "string" ? orgIdOrUserId : orgIdOrUserId;
    const userId =
      typeof userIdOrData === "string" ? userIdOrData : orgIdOrUserId;
    const data = typeof userIdOrData === "string" ? maybeData : userIdOrData;

    if (!data) {
      throw new BadRequestException("task payload is required");
    }

    const sourceVideoUrl =
      data.source?.url?.trim() || data.sourceVideoUrl?.trim();
    if (!sourceVideoUrl) {
      throw new BadRequestException("sourceVideoUrl is required");
    }

    const normalizedOrgId = isLegacySignature
      ? this.toOptionalObjectId(orgId)
      : this.toObjectId(orgId, "orgId");
    const batchObjectId = this.toOptionalObjectId(data.batchId);

    await this.ensureBrandBelongsToOrg(data.brandId, normalizedOrgId);
    await this.ensurePipelineBelongsToOrg(data.pipelineId, normalizedOrgId);
    await this.ensureBatchBelongsToOrg(batchObjectId, normalizedOrgId);

    if (this.dedupService && normalizedOrgId) {
      const duplicateCheck = await this.dedupService.checkDuplicate(
        normalizedOrgId.toString(),
        this.buildDedupContentSignature(data),
        "video_task",
      );

      if (duplicateCheck.isDuplicate) {
        throw new BadRequestException(
          `Duplicate content detected for this organization. Existing videoTaskId: ${duplicateCheck.existing?.videoTaskId || "unknown"}`,
        );
      }
    }

    const taskId = new Types.ObjectId();
    const durationSec = this.resolveRequestedDurationSec(data);
    const usageCharge = await this.usageService.chargeVideo(
      userId,
      normalizedOrgId?.toString() || null,
      durationSec,
      {
        videoTaskId: taskId.toString(),
        metadata: {
          brandId: data.brandId || null,
          pipelineId: data.pipelineId || null,
          batchId: batchObjectId?.toString() || null,
          taskType: data.taskType,
          sourceType: data.source?.type || "url",
        },
      },
    );

    const draftedAt = new Date();
    const queuedAt = new Date(draftedAt.getTime() + 1);
    const metadata = {
      ...(data.metadata || {}),
      productionStage: mapVideoTaskStatusToProductionStage(
        VideoTaskStatus.PENDING,
      ),
      timeline: [
        {
          status: "draft",
          rawStatus: VideoTaskStatus.DRAFT,
          timestamp: draftedAt.toISOString(),
          message: "Task drafted",
        },
        {
          status: "queued",
          rawStatus: VideoTaskStatus.PENDING,
          timestamp: queuedAt.toISOString(),
          message: "Queued for processing",
        },
      ],
      billing: {
        usageHistoryId: usageCharge.usageHistoryId,
        usageHistoryIds:
          usageCharge.usageHistoryIds ||
          [usageCharge.usageHistoryId].filter(Boolean),
        packId: usageCharge.packId,
        packIds: usageCharge.packIds || [usageCharge.packId].filter(Boolean),
        allocations: usageCharge.allocations || [],
        units: usageCharge.units,
        chargedAt: new Date().toISOString(),
      },
    };

    const iterationLog = [
      createStatusTransitionIterationEntry([], {
        fromStatus: null,
        toStatus: VideoTaskStatus.DRAFT,
        timestamp: draftedAt,
        detail: {
          source: "video-service",
          reason: "task_created",
        },
      }),
      createStatusTransitionIterationEntry([], {
        fromStatus: VideoTaskStatus.DRAFT,
        toStatus: VideoTaskStatus.PENDING,
        timestamp: queuedAt,
        detail: {
          source: "video-service",
          reason: "task_queued",
        },
      }),
    ];

    const taskPayload = {
      _id: taskId,
      userId,
      orgId: normalizedOrgId,
      brandId: data.brandId ? new Types.ObjectId(data.brandId) : null,
      pipelineId: data.pipelineId ? new Types.ObjectId(data.pipelineId) : null,
      batchId: batchObjectId,
      taskType: data.taskType,
      status: VideoTaskStatus.PENDING,
      sourceVideoUrl,
      source: {
        type: data.source?.type?.trim() || "url",
        url: sourceVideoUrl,
        videoId:
          data.source?.videoId?.trim() ||
          this.readMetadataString(data.metadata, "videoId"),
      },
      creditsConsumed: usageCharge.units,
      quotaUnits: usageCharge.units,
      creditCharged: true,
      iterationLog,
      metadata,
    };

    let task: VideoTask | null = null;

    try {
      task = await this.videoTaskModel.create(taskPayload);
      if (this.dedupService && normalizedOrgId) {
        await this.dedupService.registerContent(
          normalizedOrgId.toString(),
          this.buildDedupContentSignature(data),
          task._id.toString(),
          "video_task",
        );
      }
      await this.enqueueTask(task._id.toString());

      if (task.batchId) {
        await this.syncBatchStats(task.batchId.toString());
      }

      this.logger.log(
        `Video task created: ${task._id}, type: ${data.taskType}`,
      );
      return task;
    } catch (error) {
      if (task?._id) {
        await this.videoTaskModel.findByIdAndDelete(task._id).exec();
      }

      if (
        (usageCharge.usageHistoryIds || []).length > 0 ||
        usageCharge.usageHistoryId
      ) {
        await this.usageService
          .refundVideoCharge(
            userId,
            normalizedOrgId?.toString() || null,
            taskId.toString(),
            {
              refundReason: "task_create_failed",
              errorMessage:
                error instanceof Error ? error.message : String(error),
            },
          )
          .catch(() => undefined);
      } else if (this.billingService) {
        await this.billingService
          .refundCredit(userId, usageCharge.units)
          .catch(() => undefined);
      }

      if (batchObjectId) {
        await this.syncBatchStats(batchObjectId.toString()).catch(
          () => undefined,
        );
      }

      throw error;
    }
  }

  async createBatch(orgId: string, userId: string, data: CreateBatchInput) {
    if (!data.batchName?.trim()) {
      throw new BadRequestException("batchName is required");
    }

    if (!Array.isArray(data.tasks) || data.tasks.length === 0) {
      throw new BadRequestException("tasks is required");
    }

    const normalizedOrgId = this.toObjectId(orgId, "orgId");
    await this.ensureBrandBelongsToOrg(data.brandId, normalizedOrgId);

    const batch = await this.productionBatchModel.create({
      orgId: normalizedOrgId,
      brandId: this.toOptionalObjectId(data.brandId),
      batchName: data.batchName.trim(),
      status: ProductionBatchStatus.PENDING,
      tasks: [],
      totalTasks: data.tasks.length,
      completedTasks: 0,
      failedTasks: 0,
      userId,
      createdBy: userId,
      startedAt: new Date(),
      completedAt: null,
      summary: {},
    });

    for (const taskInput of data.tasks) {
      try {
        const task = await this.createTask(orgId, userId, {
          ...taskInput,
          brandId: taskInput.brandId || data.brandId,
          batchId: batch._id.toString(),
        });

        await this.productionBatchModel
          .findByIdAndUpdate(batch._id, {
            $push: {
              tasks: {
                taskId: task._id,
                status: task.status,
                sourceVideoUrl: task.sourceVideoUrl,
                errorMessage: task.errorMessage || "",
              },
            },
          })
          .exec();
      } catch (error) {
        const failedTask = await this.videoTaskModel.create({
          userId,
          orgId: normalizedOrgId,
          brandId: this.toOptionalObjectId(taskInput.brandId || data.brandId),
          pipelineId: this.toOptionalObjectId(taskInput.pipelineId),
          batchId: batch._id,
          taskType: taskInput.taskType,
          status: VideoTaskStatus.FAILED,
          sourceVideoUrl:
            taskInput.source?.url?.trim() ||
            taskInput.sourceVideoUrl?.trim() ||
            "",
          source: {
            type: taskInput.source?.type?.trim() || "url",
            url:
              taskInput.source?.url?.trim() ||
              taskInput.sourceVideoUrl?.trim() ||
              "",
            videoId: taskInput.source?.videoId?.trim() || "",
          },
          creditsConsumed: 0,
          creditCharged: false,
          errorMessage: error instanceof Error ? error.message : String(error),
          errorLog: [
            {
              step: "batch-create",
              message: error instanceof Error ? error.message : String(error),
              detail: {
                batchId: batch._id.toString(),
              },
              recordedAt: new Date(),
            },
          ],
          metadata: {
            ...(taskInput.metadata || {}),
            batch: {
              createFailed: true,
            },
          },
        });

        await this.productionBatchModel
          .findByIdAndUpdate(batch._id, {
            $push: {
              tasks: {
                taskId: failedTask._id,
                status: failedTask.status,
                sourceVideoUrl: failedTask.sourceVideoUrl,
                errorMessage: failedTask.errorMessage || "",
              },
            },
          })
          .exec();
      }
    }

    return this.getBatchStatus(orgId, batch._id.toString());
  }

  async getBatchStatus(orgId: string, batchId: string) {
    const batch = await this.productionBatchModel
      .findOne({
        _id: this.toObjectId(batchId, "batchId"),
        orgId: this.toObjectId(orgId, "orgId"),
      })
      .lean()
      .exec();

    if (!batch) {
      throw new NotFoundException("Production batch not found");
    }

    const tasks = await this.videoTaskModel
      .find({
        batchId: batch._id,
      })
      .select({
        _id: 1,
        status: 1,
        taskType: 1,
        brandId: 1,
        pipelineId: 1,
        errorMessage: 1,
        sourceVideoUrl: 1,
        createdAt: 1,
        completedAt: 1,
      })
      .lean()
      .exec();

    return {
      id: batch._id.toString(),
      orgId: batch.orgId.toString(),
      brandId: batch.brandId?.toString() || null,
      batchName: batch.batchName,
      status: batch.status,
      totalTasks: batch.totalTasks,
      completedTasks: batch.completedTasks,
      failedTasks: batch.failedTasks,
      createdBy: batch.createdBy,
      startedAt: batch.startedAt,
      completedAt: batch.completedAt,
      summary: batch.summary || {},
      tasks: tasks.map((task) => ({
        taskId: task._id.toString(),
        status: task.status,
        taskType: task.taskType,
        brandId: task.brandId?.toString() || null,
        pipelineId: task.pipelineId?.toString() || null,
        errorMessage: task.errorMessage || "",
        sourceVideoUrl: task.sourceVideoUrl || "",
        createdAt: task.createdAt,
        completedAt: task.completedAt,
      })),
    };
  }

  async listTasks(
    orgId: string,
    userId: string,
    filters?: {
      status?: VideoTaskStatus;
      brandId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const query: Record<string, any> = {
      userId,
      orgId: this.toObjectId(orgId, "orgId"),
    };
    if (filters?.status) {
      query["status"] = filters.status;
    }
    if (filters?.brandId) {
      query["brandId"] = new Types.ObjectId(filters.brandId);
    }

    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const [tasks, total] = await Promise.all([
      this.videoTaskModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.videoTaskModel.countDocuments(query),
    ]);

    return { tasks, total, page, limit };
  }

  async getTask(orgId: string, taskId: string) {
    const task = await this.videoTaskModel
      .findOne(this.buildOwnershipQuery(orgId, taskId))
      .exec();
    if (!task) {
      throw new NotFoundException("Video task not found");
    }
    return task;
  }

  async getTaskForWorker(taskId: string) {
    const task = await this.videoTaskModel
      .findById(this.toObjectId(taskId, "taskId"))
      .exec();
    if (!task) {
      throw new NotFoundException("Video task not found");
    }

    return task;
  }

  async getIterations(orgId: string, taskId: string) {
    const task = await this.getTask(orgId, taskId);
    return {
      taskId: task._id.toString(),
      status: task.status,
      iterationLog: task.iterationLog || [],
    };
  }

  async updateStatus(
    taskId: string,
    status: VideoTaskStatus,
    data?: UpdateTaskStatusInput,
  ) {
    const task = await this.videoTaskModel
      .findById(this.toObjectId(taskId, "taskId"))
      .exec();
    if (!task) {
      throw new NotFoundException("Video task not found");
    }

    const transitionedAt = new Date();
    const timelineEntry = {
      status: this.mapTimelineStatus(status),
      rawStatus: status,
      timestamp: transitionedAt.toISOString(),
    };

    const updateSet: Record<string, any> = {
      status,
      "metadata.productionStage": mapVideoTaskStatusToProductionStage(status),
    };
    if (data?.outputVideoUrl) {
      updateSet["outputVideoUrl"] = data.outputVideoUrl;
      updateSet["output.url"] = data.outputVideoUrl;
    }
    if (data && Object.prototype.hasOwnProperty.call(data, "errorMessage")) {
      updateSet["errorMessage"] = data.errorMessage || "";
    }
    if (data?.quality) {
      updateSet["quality"] = data.quality;
      updateSet["output.duration"] = Number(data.quality["duration"] || 0);
      updateSet["output.resolution"] = this.buildResolution(data.quality);
    }
    if (data?.copy) {
      updateSet["copy"] = data.copy;
    }
    if (data?.deepSynthesis) {
      updateSet["metadata.compliance.aiDeepSynthesis"] = data.deepSynthesis;
    }
    if (data?.metadata) {
      for (const [key, value] of Object.entries(data.metadata)) {
        updateSet[`metadata.${key}`] = value;
      }
    }

    if (
      !task.startedAt &&
      [
        VideoTaskStatus.ANALYZING,
        VideoTaskStatus.EDITING,
        VideoTaskStatus.RENDERING,
        VideoTaskStatus.QUALITY_CHECK,
        VideoTaskStatus.GENERATING_COPY,
      ].includes(status)
    ) {
      updateSet["startedAt"] = transitionedAt;
    }
    if (
      [
        VideoTaskStatus.COMPLETED,
        VideoTaskStatus.FAILED,
        VideoTaskStatus.CANCELLED,
      ].includes(status)
    ) {
      updateSet["completedAt"] = transitionedAt;
    }

    const pushPayload: Record<string, any> = {
      iterationLog: createStatusTransitionIterationEntry(
        (task.iterationLog as Array<Record<string, any>>) || [],
        {
          fromStatus: task.status,
          toStatus: status,
          timestamp: transitionedAt,
          detail: {
            source: "video-service",
            step: data?.step || this.mapStatusToStep(status),
          },
        },
      ),
      "metadata.timeline": timelineEntry,
    };

    if (data?.errorMessage) {
      pushPayload["errorLog"] = {
        step: data.step || this.mapStatusToStep(status),
        message: data.errorMessage,
        detail: data.metadata || {},
        recordedAt: transitionedAt,
      };
    }

    if (status === VideoTaskStatus.FAILED && task.creditCharged) {
      const refundResult = await this.usageService.refundVideoCharge(
        task.userId,
        task.orgId?.toString() || null,
        taskId,
        {
          taskId,
          refundReason: "task_failed",
          errorMessage: data?.errorMessage || "",
        },
      );

      if (!refundResult.refunded && this.billingService) {
        await this.billingService.refundCredit(
          task.userId,
          task.creditsConsumed || 1,
        );
      }

      updateSet["creditCharged"] = false;
      updateSet["metadata.creditRefundedAt"] = transitionedAt.toISOString();
    }

    const updated = await this.videoTaskModel
      .findByIdAndUpdate(
        taskId,
        {
          $set: updateSet,
          $push: pushPayload,
        },
        { new: true },
      )
      .exec();

    if (updated?.batchId) {
      await this.syncBatchStats(updated.batchId.toString());
    }

    if (updated) {
      await this.handlePromptOptimizerStatusHook(updated, status, data).catch(
        (error) => {
          this.logger.warn(
            `Prompt optimizer hook skipped for ${updated._id.toString()}: ${error instanceof Error ? error.message : String(error)}`,
          );
        },
      );
    }

    if (
      status === VideoTaskStatus.FAILED &&
      updated?.orgId &&
      this.notificationService
    ) {
      await this.notificationService
        .send(updated.orgId.toString(), NotificationEvent.TASK_FAILED, {
          taskId: updated._id.toString(),
          contentId: updated._id.toString(),
          orgId: updated.orgId.toString(),
          userId: updated.userId,
          status: updated.status,
          errorMessage: updated.errorMessage || data?.errorMessage || "",
          step: data?.step || this.mapStatusToStep(status),
          metadata: updated.metadata || {},
        })
        .catch((error) => {
          this.logger.warn(
            `Task failure notification skipped for ${updated?._id?.toString?.() || taskId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }

    return updated;
  }

  async recordRetry(taskId: string, retryCount: number, errorMessage: string) {
    return this.videoTaskModel
      .findByIdAndUpdate(
        this.toObjectId(taskId, "taskId"),
        {
          retryCount,
          errorMessage,
        },
        { new: true },
      )
      .exec();
  }

  async markPublished(orgId: string, taskId: string) {
    const task = await this.getTask(orgId, taskId);
    const publishedAt = new Date();
    const updated = await this.videoTaskModel
      .findOneAndUpdate(
        this.buildOwnershipQuery(orgId, taskId),
        {
          $set: {
            status: VideoTaskStatus.PUBLISHED,
            publishedAt,
            "metadata.publishedAt": publishedAt.toISOString(),
            "metadata.productionStage": mapVideoTaskStatusToProductionStage(
              VideoTaskStatus.PUBLISHED,
            ),
          },
          $push: {
            iterationLog: createStatusTransitionIterationEntry(
              (task.iterationLog as Array<Record<string, any>>) || [],
              {
                fromStatus: task.status,
                toStatus: VideoTaskStatus.PUBLISHED,
                timestamp: publishedAt,
                detail: {
                  source: "video-service",
                  step: "publish",
                },
              },
            ),
            "metadata.timeline": {
              status: "published",
              rawStatus: VideoTaskStatus.PUBLISHED,
              timestamp: publishedAt.toISOString(),
            },
          },
        },
        { new: true },
      )
      .exec();

    if (updated?.batchId) {
      await this.syncBatchStats(updated.batchId.toString());
    }

    if (updated && this.employeeDispatchService) {
      await this.employeeDispatchService
        .confirmPublished(orgId, taskId)
        .catch((error) => {
          this.logger.warn(
            `Employee publish confirmation failed for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
    }

    return updated;
  }

  async editCopy(
    orgId: string,
    taskId: string,
    copy: {
      title?: string;
      subtitle?: string;
      description?: string;
      hashtags?: string[];
      commentGuide?: string;
    },
  ) {
    await this.getTask(orgId, taskId);
    return this.videoTaskModel
      .findOneAndUpdate(
        this.buildOwnershipQuery(orgId, taskId),
        { $set: { copy } },
        { new: true },
      )
      .exec();
  }

  async startIterationStep(
    taskId: string,
    step: string,
    input: Record<string, any> = {},
  ) {
    const task = await this.videoTaskModel
      .findById(this.toObjectId(taskId, "taskId"))
      .exec();
    if (!task) {
      return null;
    }

    const attempt =
      (task.iterationLog || []).filter((entry) => entry.step === step).length +
      1;

    task.iterationLog.push({
      step,
      status: "processing",
      input,
      output: {},
      error: "",
      duration: 0,
      attempt,
      timestamps: {
        startedAt: new Date(),
        completedAt: null,
      },
    } as any);

    await task.save();
    return task;
  }

  async completeIterationStep(
    taskId: string,
    step: string,
    output: Record<string, any> = {},
  ) {
    return this.finalizeIterationStep(taskId, step, "completed", output);
  }

  async failIterationStep(
    taskId: string,
    step: string,
    errorMessage: string,
    output: Record<string, any> = {},
  ) {
    return this.finalizeIterationStep(
      taskId,
      step,
      "failed",
      output,
      errorMessage,
    );
  }

  async appendPromptFix(
    taskId: string,
    payload: {
      originalPrompt: string;
      optimizedPrompt: string;
      failureReason: string;
      retriedAt?: Date | null;
      result?: string;
    },
  ) {
    return this.videoTaskModel
      .findByIdAndUpdate(
        this.toObjectId(taskId, "taskId"),
        {
          $push: {
            promptFixes: {
              originalPrompt: payload.originalPrompt,
              optimizedPrompt: payload.optimizedPrompt,
              failureReason: payload.failureReason,
              retriedAt: payload.retriedAt || null,
              result: payload.result || "",
            },
          },
        },
        { new: true },
      )
      .exec();
  }

  async updateTaskMetadata(taskId: string, metadata: Record<string, any>) {
    const setPayload = Object.fromEntries(
      Object.entries(metadata).map(([key, value]) => [
        `metadata.${key}`,
        value,
      ]),
    );

    return this.videoTaskModel
      .findByIdAndUpdate(
        this.toObjectId(taskId, "taskId"),
        {
          $set: setPayload,
        },
        { new: true },
      )
      .exec();
  }

  private async finalizeIterationStep(
    taskId: string,
    step: string,
    status: "completed" | "failed",
    output: Record<string, any>,
    errorMessage = "",
  ) {
    const task = await this.videoTaskModel
      .findById(this.toObjectId(taskId, "taskId"))
      .exec();
    if (!task) {
      return null;
    }

    const entries = task.iterationLog || [];
    const index = [...entries].reverse().findIndex((entry) => {
      const timestamps = (entry as any).timestamps || {};
      return entry.step === step && !timestamps.completedAt;
    });
    const now = new Date();

    if (index === -1) {
      const attempt = entries.filter((entry) => entry.step === step).length + 1;
      entries.push({
        step,
        status,
        input: {},
        output,
        error: errorMessage,
        duration: 0,
        attempt,
        timestamps: {
          startedAt: now,
          completedAt: now,
        },
      } as any);
    } else {
      const entryIndex = entries.length - 1 - index;
      const entry = entries[entryIndex] as any;
      entry.status = status;
      entry.output = output;
      entry.error = errorMessage;
      entry.timestamps = {
        ...(entry.timestamps || {}),
        completedAt: now,
      };
      const startedAt = entry.timestamps?.startedAt
        ? new Date(entry.timestamps.startedAt)
        : now;
      entry.duration = Math.max(now.getTime() - startedAt.getTime(), 0);
    }

    task.iterationLog = entries as any;
    await task.save();
    return task;
  }

  private async syncBatchStats(batchId: string) {
    const batchObjectId = this.toObjectId(batchId, "batchId");
    const [batch, tasks] = await Promise.all([
      this.productionBatchModel.findById(batchObjectId).exec(),
      this.videoTaskModel
        .find({ batchId: batchObjectId })
        .select({
          _id: 1,
          status: 1,
          creditsConsumed: 1,
          completedAt: 1,
          errorMessage: 1,
          sourceVideoUrl: 1,
        })
        .lean()
        .exec(),
    ]);

    if (!batch) {
      return null;
    }

    const totalTasks = Math.max(batch.totalTasks || 0, tasks.length);
    const completedTasks = tasks.filter((task) =>
      this.isSuccessfulTaskStatus(task.status),
    ).length;
    const failedTasks = tasks.filter((task) =>
      this.isFailedTaskStatus(task.status),
    ).length;
    const terminalTasks = completedTasks + failedTasks;

    let status = ProductionBatchStatus.PENDING;
    if (tasks.length > 0) {
      status = ProductionBatchStatus.PROCESSING;
    }
    if (totalTasks > 0 && completedTasks === totalTasks) {
      status = ProductionBatchStatus.COMPLETED;
    } else if (totalTasks > 0 && failedTasks === totalTasks) {
      status = ProductionBatchStatus.FAILED;
    } else if (
      totalTasks > 0 &&
      terminalTasks >= totalTasks &&
      completedTasks > 0 &&
      failedTasks > 0
    ) {
      status = ProductionBatchStatus.PARTIAL;
    }

    const isTerminal = [
      ProductionBatchStatus.COMPLETED,
      ProductionBatchStatus.FAILED,
      ProductionBatchStatus.PARTIAL,
    ].includes(status);
    const summary = isTerminal
      ? {
          totalTasks,
          completedTasks,
          failedTasks,
          successRate:
            totalTasks > 0
              ? Number(((completedTasks / totalTasks) * 100).toFixed(2))
              : 0,
          creditsConsumed: tasks.reduce(
            (sum, task) => sum + Number(task.creditsConsumed || 0),
            0,
          ),
        }
      : batch.summary || {};

    await this.productionBatchModel
      .findByIdAndUpdate(batch._id, {
        $set: {
          status,
          tasks: tasks.map((task) => ({
            taskId: task._id,
            status: task.status,
            sourceVideoUrl: task.sourceVideoUrl || "",
            errorMessage: task.errorMessage || "",
          })),
          totalTasks,
          completedTasks,
          failedTasks,
          startedAt: batch.startedAt || new Date(),
          completedAt: isTerminal ? new Date() : null,
          summary,
        },
      })
      .exec();

    return status;
  }

  private async enqueueTask(taskId: string) {
    if (!this.videoWorkerQueue) {
      return;
    }

    await this.videoWorkerQueue.add(
      "analyze-source",
      { taskId },
      { jobId: `${taskId}:analyze-source` },
    );
  }

  private buildOwnershipQuery(orgId: string, taskId: string) {
    return {
      _id: this.toObjectId(taskId, "taskId"),
      orgId: this.toObjectId(orgId, "orgId"),
    };
  }

  private async handlePromptOptimizerStatusHook(
    task: VideoTask,
    status: VideoTaskStatus,
    data?: UpdateTaskStatusInput,
  ) {
    if (!this.promptOptimizerService) {
      return;
    }

    if (data?.metadata?.["promptOptimizerHandled"]) {
      return;
    }

    const step = data?.step || this.mapStatusToStep(status);
    if (!this.isQualityCheckStep(step)) {
      return;
    }

    if (status === VideoTaskStatus.COMPLETED) {
      await this.promptOptimizerService.logIteration(
        task._id.toString(),
        step,
        {
          status: "success",
          originalPrompt: this.readOptimizerOriginalPrompt(task),
          qualityScore: this.readOptimizerQualityScore(task),
          strategyUsed: this.readOptimizerStrategy(task),
          metadata: {
            source: "video-service",
            trigger: "quality_check_completed",
          },
        },
      );
      return;
    }

    if (status !== VideoTaskStatus.FAILED) {
      return;
    }

    const analysis = await this.promptOptimizerService.analyzeFailure(
      task._id.toString(),
      step,
      this.readOptimizerOriginalPrompt(task),
      {
        errorMessage:
          data?.errorMessage || task.errorMessage || "Quality check failed",
        qualityScore: this.readOptimizerQualityScore(task),
        metadata: data?.metadata || {},
      },
    );
    const history = await this.promptOptimizerService.getIterationHistory(
      task._id.toString(),
    );
    const retryDecision = this.resolveOptimizerRetryDecision(
      history.length + 1,
    );

    await this.promptOptimizerService.logIteration(task._id.toString(), step, {
      status: retryDecision.shouldRetry ? "retried" : "failed",
      originalPrompt: analysis.originalPrompt,
      optimizedPrompt: analysis.optimizedPrompt,
      failureAnalysis: analysis.failureAnalysis,
      qualityScore: analysis.qualityScore,
      strategyUsed: retryDecision.strategy,
      metadata: {
        source: "video-service",
        trigger: "quality_check_failed",
        errorMessage: data?.errorMessage || task.errorMessage || "",
      },
    });

    if (!retryDecision.shouldRetry) {
      return;
    }

    const retryResult =
      await this.promptOptimizerService.queueRetryWithOptimizedPrompt(
        task._id.toString(),
        step,
        analysis.optimizedPrompt,
        retryDecision.strategy,
      );

    if (!retryResult.queued) {
      this.logger.warn(
        `Prompt optimizer retry queue skipped for ${task._id.toString()}: ${retryResult.reason || "unknown reason"}`,
      );
    }
  }

  private readOptimizerOriginalPrompt(task: VideoTask) {
    const pipelineContext = task.metadata?.["pipelineContext"];
    if (!pipelineContext || typeof pipelineContext !== "object") {
      return "";
    }

    const prompts = (pipelineContext as Record<string, unknown>)["prompts"];
    if (!prompts || typeof prompts !== "object" || Array.isArray(prompts)) {
      return "";
    }

    const promptMap = prompts as Record<string, unknown>;
    for (const key of ["render-video", "edit-frames", "generate-copy"]) {
      const value = promptMap[key];
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }

    return "";
  }

  private readOptimizerStrategy(task: VideoTask) {
    const promptOptimizer = task.metadata?.["promptOptimizer"];
    if (!promptOptimizer || typeof promptOptimizer !== "object") {
      return "default";
    }

    const lastRetry = (promptOptimizer as Record<string, unknown>)["lastRetry"];
    if (!lastRetry || typeof lastRetry !== "object") {
      return "default";
    }

    const strategy = (lastRetry as Record<string, unknown>)["strategy"];
    return typeof strategy === "string" && strategy.trim()
      ? strategy
      : "default";
  }

  private readOptimizerQualityScore(task: VideoTask) {
    const quality = task.quality as Record<string, any> | undefined;
    if (!quality) {
      return undefined;
    }

    const width = Number(quality["width"] || 0);
    const height = Number(quality["height"] || 0);
    const duration = Number(quality["duration"] || 0);
    const fileSize = Number(quality["fileSize"] || 0);
    const hasSubtitles = Boolean(quality["hasSubtitles"]);

    if (
      ![width, height, duration, fileSize].some((value) => value > 0) &&
      !hasSubtitles
    ) {
      return undefined;
    }

    const shortEdge = Math.min(width || 0, height || 0);
    const resolution =
      shortEdge >= 1080 ? 100 : shortEdge >= 720 ? 86 : shortEdge > 0 ? 60 : 0;
    const fileSizeScore =
      fileSize >= 2 * 1024 * 1024
        ? 96
        : fileSize >= 500 * 1024
          ? 82
          : fileSize > 0
            ? 55
            : 0;
    const subtitles = hasSubtitles ? 92 : 70;
    const durationScore =
      duration >= 10 && duration <= 60 ? 95 : duration > 0 ? 68 : 0;
    const clarity = hasSubtitles ? 88 : 72;
    const composition = resolution >= 86 ? 88 : 70;
    const viralityHook = duration >= 10 && duration <= 60 ? 84 : 66;

    const production = Number(
      ((resolution + fileSizeScore + subtitles + durationScore) / 4).toFixed(2),
    );
    const virality = Number(
      ((clarity + composition + viralityHook) / 3).toFixed(2),
    );

    return {
      total: Number((production * 0.4 + virality * 0.6).toFixed(2)),
      production,
      virality,
      dimensions: {
        resolution,
        fileSize: fileSizeScore,
        subtitles,
        duration: durationScore,
        clarity,
        composition,
        viralityHook,
      },
    };
  }


  private resolveOptimizerRetryDecision(iteration: number) {
    if (iteration < 2) {
      return {
        shouldRetry: true,
        strategy: "retry_optimized" as const,
      };
    }

    if (iteration === 2) {
      return {
        shouldRetry: true,
        strategy: "fallback_strategy" as const,
      };
    }

    return {
      shouldRetry: false,
      strategy: "needs_manual_review" as const,
    };
  }

  private isQualityCheckStep(step: string) {
    return (
      step.trim().toLowerCase() === "quality-check" ||
      step.trim().toLowerCase() === "quality_check"
    );
  }

  private toObjectId(value: string, field: string) {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(`${field} is invalid`);
    }

    return new Types.ObjectId(value);
  }

  private toOptionalObjectId(value: string | null | undefined) {
    return value && Types.ObjectId.isValid(value)
      ? new Types.ObjectId(value)
      : null;
  }

  private async ensureBrandBelongsToOrg(
    brandId: string | undefined,
    orgId: Types.ObjectId | null,
  ) {
    if (!brandId || !orgId) {
      return;
    }

    const brand = await this.brandModel.exists({
      _id: this.toObjectId(brandId, "brandId"),
      orgId,
      isActive: true,
    });

    if (!brand) {
      throw new NotFoundException("Brand not found in organization");
    }
  }

  private async ensurePipelineBelongsToOrg(
    pipelineId: string | undefined,
    orgId: Types.ObjectId | null,
  ) {
    if (!pipelineId || !orgId) {
      return;
    }

    const pipeline = await this.pipelineModel.exists({
      _id: this.toObjectId(pipelineId, "pipelineId"),
      orgId,
    });

    if (!pipeline) {
      throw new NotFoundException("Pipeline not found in organization");
    }
  }

  private async ensureBatchBelongsToOrg(
    batchId: Types.ObjectId | null,
    orgId: Types.ObjectId | null,
  ) {
    if (!batchId || !orgId) {
      return;
    }

    const batch = await this.productionBatchModel.exists({
      _id: batchId,
      orgId,
    });

    if (!batch) {
      throw new NotFoundException("Production batch not found in organization");
    }
  }

  private resolveRequestedDurationSec(data: CreateTaskInput) {
    const candidates = [
      data.metadata?.["targetDurationSeconds"],
      data.metadata?.["durationSeconds"],
      data.metadata?.["durationSec"],
      data.metadata?.["targetDuration"],
    ];

    for (const value of candidates) {
      const normalized = Number(value || 0);
      if (Number.isFinite(normalized) && normalized > 0) {
        return normalized;
      }
    }

    return 15;
  }

  private readUsageHistoryId(metadata: Record<string, any> | undefined) {
    const usageHistoryId = metadata?.["billing"]?.["usageHistoryId"];
    return typeof usageHistoryId === "string" &&
      Types.ObjectId.isValid(usageHistoryId)
      ? usageHistoryId
      : null;
  }

  private readMetadataString(
    metadata: Record<string, any> | undefined,
    key: string,
  ) {
    const value = metadata?.[key];
    return typeof value === "string" ? value.trim() : "";
  }

  private buildDedupContentSignature(data: CreateTaskInput) {
    const metadata = data.metadata || {};

    return [
      data.taskType,
      data.brandId || "",
      data.pipelineId || "",
      data.source?.videoId?.trim() || "",
      data.source?.url?.trim() || "",
      data.sourceVideoUrl?.trim() || "",
      this.readMetadataString(metadata, "scene"),
      this.readMetadataString(metadata, "theme"),
      this.readMetadataString(metadata, "campaign"),
      this.readMetadataString(metadata, "platform"),
      this.readMetadataString(metadata, "style"),
    ]
      .filter(Boolean)
      .join(" | ");
  }

  private buildResolution(quality: Record<string, any>) {
    const width = Number(quality["width"] || 0);
    const height = Number(quality["height"] || 0);
    return width > 0 && height > 0 ? `${width}x${height}` : "";
  }

  private mapTimelineStatus(status: VideoTaskStatus) {
    switch (status) {
      case VideoTaskStatus.PENDING:
        return "queued";
      case VideoTaskStatus.PENDING_REVIEW:
        return "pending_review";
      case VideoTaskStatus.APPROVED:
        return "approved";
      case VideoTaskStatus.REJECTED:
        return "rejected";
      case VideoTaskStatus.PUBLISHED:
        return "published";
      case VideoTaskStatus.COMPLETED:
        return "completed";
      case VideoTaskStatus.FAILED:
        return "failed";
      case VideoTaskStatus.CANCELLED:
        return "cancelled";
      default:
        return "processing";
    }
  }

  private mapStatusToStep(status: VideoTaskStatus) {
    switch (status) {
      case VideoTaskStatus.ANALYZING:
        return "analyze-source";
      case VideoTaskStatus.EDITING:
        return "edit-frames";
      case VideoTaskStatus.RENDERING:
        return "render-video";
      case VideoTaskStatus.QUALITY_CHECK:
        return "quality-check";
      case VideoTaskStatus.GENERATING_COPY:
        return "generate-copy";
      default:
        return "video-task";
    }
  }

  private isSuccessfulTaskStatus(status: VideoTaskStatus) {
    return [
      VideoTaskStatus.COMPLETED,
      VideoTaskStatus.APPROVED,
      VideoTaskStatus.PUBLISHED,
    ].includes(status);
  }

  private isFailedTaskStatus(status: VideoTaskStatus) {
    return [VideoTaskStatus.FAILED, VideoTaskStatus.CANCELLED].includes(status);
  }
}
