import { Body, Get, Post, Query } from "@nestjs/common";
import { GetToken } from "@yikart/aitoearn-auth";
import { MediaClawApiController } from "../mediaclaw-api.decorator";
import { ContentRemixService } from "./content-remix.service";
import { DiscoveryService } from "./discovery.service";

@MediaClawApiController("api/v1/discovery")
export class DiscoveryController {
  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly contentRemixService: ContentRemixService,
  ) {}

  @Get("pool")
  async getRecommendationPool(
    @GetToken() user: any,
    @Query("limit") limit = "10",
    @Query("industry") industry?: string,
  ) {
    return this.discoveryService.getRecommendationPool(
      user.orgId || user.id,
      Number(limit),
      industry,
    );
  }

  @Post("score")
  async calculateViralScore(
    @Body()
    body: {
      views?: number;
      likes?: number;
      comments?: number;
      shares?: number;
      publishedAt?: string;
      videoKeywords?: string[];
      industryKeywords?: string[];
    },
  ) {
    return {
      viralScore: this.discoveryService.calculateViralScore(
        {
          views: body.views,
          likes: body.likes,
          comments: body.comments,
          shares: body.shares,
          keywords: body.videoKeywords,
        },
        body.publishedAt,
        body.industryKeywords || [],
      ),
    };
  }

  @Post("mark-remixed")
  async markRemixed(@Body() body: { contentId?: string; taskId?: string }) {
    return this.discoveryService.markRemixed(
      body.contentId || "",
      body.taskId || "",
    );
  }

  @Post("analyze-viral-elements")
  async analyzeViralElements(@Body() body: { contentId?: string }) {
    return this.contentRemixService.analyzeViralElements(body.contentId || "");
  }

  @Post("generate-remix-brief")
  async generateRemixBrief(
    @Body() body: { contentId?: string; brandId?: string },
  ) {
    return this.contentRemixService.generateRemixBrief(
      body.contentId || "",
      body.brandId || "",
    );
  }

  @Post("apply-remix-insights")
  async applyRemixInsights(
    @Body() body: { contentId?: string; pipelineId?: string },
  ) {
    return this.contentRemixService.applyRemixInsights(
      body.contentId || "",
      body.pipelineId || "",
    );
  }
}
