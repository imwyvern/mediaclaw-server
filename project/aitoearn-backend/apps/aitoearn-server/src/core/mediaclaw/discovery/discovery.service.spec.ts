import { Mock, vi } from "vitest";
import { Types } from "mongoose";
import { ViralContentRemixStatus } from "@yikart/mongodb";
import { DiscoveryNotificationService } from "./discovery-notification.service";
import { DiscoveryService } from "./discovery.service";

type QueryResult<T> = {
  sort: Mock;
  lean: Mock;
  exec: Mock<Promise<T>, []>;
};

const createQueryResult = <T>(value: T): QueryResult<T> => {
  const query = {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    exec: vi.fn().mockResolvedValue(value),
  };

  return query;
};

const createExecResult = <T>(value: T) => ({
  exec: vi.fn().mockResolvedValue(value),
});

describe("DiscoveryService", () => {
  let service: DiscoveryService;
  let viralContentModel: Record<string, Mock>;
  let videoTaskModel: Record<string, Mock>;
  let competitorModel: Record<string, Mock>;
  let brandModel: Record<string, Mock>;
  let organizationModel: Record<string, Mock>;
  let tikHubService: Record<string, Mock>;
  let discoveryNotificationService: Record<
    keyof DiscoveryNotificationService,
    any
  >;

  beforeEach(() => {
    vi.useFakeTimers().setSystemTime(new Date("2026-04-01T20:00:00.000Z"));

    viralContentModel = {
      find: vi.fn(),
      findOneAndUpdate: vi.fn(),
      updateMany: vi.fn(),
      findByIdAndUpdate: vi.fn(),
    };
    videoTaskModel = {
      find: vi.fn(),
      findById: vi.fn(),
    };
    competitorModel = {
      find: vi.fn(),
    };
    brandModel = {
      find: vi.fn(),
    };
    organizationModel = {
      find: vi.fn(),
    };
    tikHubService = {
      searchVideos: vi.fn(),
    };
    discoveryNotificationService = {
      notifyNewDiscoveries: vi.fn(),
    } as unknown as Record<keyof DiscoveryNotificationService, any>;

    service = new DiscoveryService(
      viralContentModel as any,
      videoTaskModel as any,
      competitorModel as any,
      brandModel as any,
      organizationModel as any,
      tikHubService as any,
      discoveryNotificationService as any,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should calculate viral score with time decay and category relevance", () => {
    const score = service.calculateViralScore(
      {
        likes: 100,
        comments: 10,
        shares: 5,
        keywords: ["beauty", "tutorial"],
      },
      "2026-04-01T19:00:00.000Z",
      ["beauty", "skincare"],
    );

    expect(score).toBe(49.6);
  });

  it("should lower viral score as publish time gets older", () => {
    const recentScore = service.calculateViralScore(
      {
        likes: 120,
        comments: 12,
        shares: 6,
        keywords: ["beauty"],
      },
      "2026-04-01T19:00:00.000Z",
      ["beauty"],
    );
    const olderScore = service.calculateViralScore(
      {
        likes: 120,
        comments: 12,
        shares: 6,
        keywords: ["beauty"],
      },
      "2026-03-30T20:00:00.000Z",
      ["beauty"],
    );

    expect(recentScore).toBeGreaterThan(olderScore);
  });

  it("should filter top p90 candidates per platform within the same industry", async () => {
    const candidates = [
      ...Array.from({ length: 20 }, (_, index) => ({
        _id: new Types.ObjectId(),
        platform: "douyin",
        industry: "beauty",
        videoId: `douyin-${index}`,
        viralScore: 100 - index,
        discoveredAt: new Date(
          `2026-04-01T${String(index).padStart(2, "0")}:00:00.000Z`,
        ),
        remixStatus: ViralContentRemixStatus.PENDING,
      })),
      ...Array.from({ length: 10 }, (_, index) => ({
        _id: new Types.ObjectId(),
        platform: "xhs",
        industry: "beauty",
        videoId: `xhs-${index}`,
        viralScore: 90 - index,
        discoveredAt: new Date(
          `2026-04-02T${String(index).padStart(2, "0")}:00:00.000Z`,
        ),
        remixStatus: ViralContentRemixStatus.PENDING,
      })),
    ];
    viralContentModel.find.mockReturnValue(createQueryResult(candidates));

    const result = await service.filterP90("beauty");

    expect(viralContentModel.find).toHaveBeenCalledWith({ industry: "beauty" });
    expect(result).toHaveLength(3);
    expect(result.map((item) => item.videoId)).toEqual([
      "douyin-0",
      "douyin-1",
      "xhs-0",
    ]);
  });

  it("should ingest search results with publishedAt and refresh platform-industry pending candidates", async () => {
    const firstId = new Types.ObjectId();
    const secondId = new Types.ObjectId();

    viralContentModel.findOneAndUpdate
      .mockReturnValueOnce(createQueryResult({ _id: firstId }))
      .mockReturnValueOnce(createQueryResult({ _id: secondId }));
    viralContentModel.find.mockReturnValueOnce(
      createQueryResult([
        {
          _id: firstId,
          platform: "douyin",
          industry: "beauty",
          viralScore: 74.4,
          discoveredAt: new Date("2026-04-01T20:00:00.000Z"),
        },
        {
          _id: secondId,
          platform: "douyin",
          industry: "beauty",
          viralScore: 12.2,
          discoveredAt: new Date("2026-04-01T20:00:00.000Z"),
        },
      ]),
    );
    viralContentModel.updateMany
      .mockReturnValueOnce(createExecResult({ modifiedCount: 2 }))
      .mockReturnValueOnce(createExecResult({ modifiedCount: 1 }));

    const result = await service.ingestSearchResults({
      platform: "douyin",
      industry: "beauty",
      keywords: ["beauty", "makeup"],
      items: [
        {
          platform: "douyin",
          videoId: "video-1",
          title: "Beauty makeup tips",
          author: "creator-a",
          contentUrl: "https://example.com/1",
          thumbnailUrl: "https://example.com/t1.jpg",
          publishedAt: "2026-03-31T20:00:00.000Z",
          metrics: {
            views: 1000,
            likes: 120,
            comments: 24,
            shares: 12,
          },
        },
        {
          platform: "douyin",
          videoId: "video-2",
          title: "Makeup before after",
          author: "creator-b",
          contentUrl: "https://example.com/2",
          thumbnailUrl: "https://example.com/t2.jpg",
          publishedAt: "2026-03-30T20:00:00.000Z",
          metrics: {
            views: 500,
            likes: 60,
            comments: 10,
            shares: 6,
          },
        },
      ],
    });

    expect(result).toEqual({
      industry: "beauty",
      platform: "douyin",
      scannedCount: 2,
      upsertedCount: 2,
      pendingCount: 1,
      contentIds: [firstId.toString(), secondId.toString()],
    });

    const [firstQuery, firstUpdate, firstOptions] =
      viralContentModel.findOneAndUpdate.mock.calls[0];
    expect(firstQuery).toEqual({
      platform: "douyin",
      videoId: "video-1",
    });
    expect(firstUpdate.$set.publishedAt).toEqual(
      new Date("2026-03-31T20:00:00.000Z"),
    );
    expect(firstUpdate.$set.keywords).toEqual(
      expect.arrayContaining(["beauty", "makeup"]),
    );
    expect(firstUpdate.$set.viralScore).toBeGreaterThan(0);
    expect(firstOptions).toEqual({ new: true, upsert: true });
    expect(viralContentModel.updateMany).toHaveBeenNthCalledWith(
      1,
      {
        industry: "beauty",
        platform: "douyin",
        remixStatus: { $ne: ViralContentRemixStatus.REMIXED },
      },
      {
        $set: {
          remixStatus: "rejected",
        },
      },
    );
    expect(viralContentModel.updateMany).toHaveBeenNthCalledWith(
      2,
      {
        _id: { $in: [firstId] },
        remixStatus: { $ne: ViralContentRemixStatus.REMIXED },
      },
      {
        $set: {
          remixStatus: ViralContentRemixStatus.PENDING,
        },
      },
    );
  });

  it("should append remix history when marking content as remixed", async () => {
    const contentId = new Types.ObjectId().toString();
    const taskId = new Types.ObjectId().toString();
    const brandId = new Types.ObjectId();

    videoTaskModel.findById.mockReturnValue(createQueryResult({ brandId }));
    viralContentModel.findByIdAndUpdate.mockReturnValue(
      createExecResult({
        _id: contentId,
        remixStatus: ViralContentRemixStatus.REMIXED,
      }),
    );

    await service.markRemixed(contentId, taskId);

    const updatePayload = viralContentModel.findByIdAndUpdate.mock.calls[0][1];
    expect(updatePayload.$set.remixStatus).toBe(
      ViralContentRemixStatus.REMIXED,
    );
    expect(updatePayload.$set.remixTaskId.toString()).toBe(taskId);
    expect(updatePayload.$push.remixHistory.brandId.toString()).toBe(
      brandId.toString(),
    );
    expect(updatePayload.$push.remixHistory.taskId.toString()).toBe(taskId);
  });
});
