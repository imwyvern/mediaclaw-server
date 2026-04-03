import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Brand, Pipeline, ViralContent } from "@yikart/mongodb";
import { Model, Types } from "mongoose";
import { MediaclawConfigService } from "../mediaclaw-config.service";

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

interface AnalysisResultShape {
  source: string;
  model: string;
  contentId: string;
  platform: string;
  videoId: string;
  title: string;
  summary: string;
  hooks: string[];
  narrativeBeats: string[];
  structureBreakdown: string[];
  visualMotifs: string[];
  audioCues: string[];
  copyStyle: string[];
  tagStrategy: string[];
  bestPostingTimes: string[];
  ctaStyle: string;
  risks: string[];
  fallbackReason: string;
  raw?: string;
  analyzedAt: Date;
}

interface RemixBriefShape {
  source: string;
  model: string;
  contentId: string;
  brandId: string;
  briefTitle: string;
  coreAngle: string;
  targetAudience: string;
  openingHook: string;
  scenePlan: string[];
  copyIdeas: string[];
  brandSafetyNotes: string[];
  productionNotes: string[];
  fallbackReason: string;
  raw?: string;
  generatedAt: Date;
}

type Identifier = Types.ObjectId | string | { toString(): string };

type LeanBrand = Brand & {
  _id: Identifier;
};

type LeanPipeline = Pipeline & {
  _id: Identifier;
  brandId: Identifier;
};

type LeanViralContent = ViralContent & {
  _id: Identifier;
  analysisResult?: Record<string, unknown> | null;
  remixBriefs?: Array<Record<string, unknown>>;
};

@Injectable()
export class ContentRemixService {
  private readonly logger = new Logger(ContentRemixService.name);
  private readonly defaultEndpoint =
    "https://api.vectorengine.cn/v1/chat/completions";
  private readonly defaultModel = "gemini-3.1-pro-preview";
  private readonly defaultRequestTimeoutMs = 5000;

  constructor(
    @InjectModel(ViralContent.name)
    private readonly viralContentModel: Model<ViralContent>,
    @InjectModel(Brand.name)
    private readonly brandModel: Model<Brand>,
    @InjectModel(Pipeline.name)
    private readonly pipelineModel: Model<Pipeline>,
    private readonly configService: MediaclawConfigService,
  ) {}

  async analyzeViralElements(contentId: string) {
    const content = await this.getViralContent(contentId);
    const analysis = await this.resolveAnalysis(content);

    await this.persistAnalysis(content._id.toString(), analysis);
    return analysis;
  }

  async generateRemixBrief(contentId: string, brandId: string) {
    const [content, brand] = await Promise.all([
      this.getViralContent(contentId),
      this.getBrand(brandId),
    ]);
    const brief = await this.resolveBrief(content, brand);

    await this.persistBrief(content, brand, brief);
    return brief;
  }

  async applyRemixInsights(contentId: string, pipelineId: string) {
    const [content, pipeline] = await Promise.all([
      this.getViralContent(contentId),
      this.getPipeline(pipelineId),
    ]);
    const analysis = content.analysisResult || null;
    const brief = this.findBriefForBrand(content, pipeline.brandId.toString());

    if (!analysis && !brief) {
      throw new BadRequestException(
        "No remix insights available for this content",
      );
    }

    const currentPreferences = pipeline.preferences || {};
    const mergedPreferredStyles = this.mergeUniqueStrings(
      currentPreferences.preferredStyles || [],
      this.readStringArray(analysis?.["visualMotifs"]),
    );
    const subtitlePreferences = {
      ...(currentPreferences.subtitlePreferences || {}),
      openingHook:
        this.readString(brief?.["openingHook"]) ||
        currentPreferences.subtitlePreferences?.["openingHook"] ||
        "",
      ctaStyle:
        this.readString(analysis?.["ctaStyle"]) ||
        currentPreferences.subtitlePreferences?.["ctaStyle"] ||
        "",
      copyIdeas: this.readStringArray(brief?.["copyIdeas"]),
      audioCues: this.readStringArray(analysis?.["audioCues"]),
      copyStyleNotes: this.readStringArray(analysis?.["copyStyle"]),
      hashtagIdeas: this.readStringArray(analysis?.["tagStrategy"]),
      recommendedPostingTimes: this.readStringArray(
        analysis?.["bestPostingTimes"],
      ),
      remixSourceContentId: content._id.toString(),
      remixAppliedAt: new Date().toISOString(),
    };
    const remixInsights = {
      sourceContentId: content._id.toString(),
      platform: content.platform,
      videoId: content.videoId,
      title: content.title,
      appliedAt: new Date(),
      analysis: analysis
        ? {
            source: this.readString(analysis["source"]),
            model: this.readString(analysis["model"]),
            summary: this.readString(analysis["summary"]),
            hooks: this.readStringArray(analysis["hooks"]),
            narrativeBeats: this.readStringArray(analysis["narrativeBeats"]),
            structureBreakdown: this.readStringArray(
              analysis["structureBreakdown"],
            ),
            visualMotifs: this.readStringArray(analysis["visualMotifs"]),
            audioCues: this.readStringArray(analysis["audioCues"]),
            copyStyle: this.readStringArray(analysis["copyStyle"]),
            tagStrategy: this.readStringArray(analysis["tagStrategy"]),
            bestPostingTimes: this.readStringArray(
              analysis["bestPostingTimes"],
            ),
            ctaStyle: this.readString(analysis["ctaStyle"]),
            risks: this.readStringArray(analysis["risks"]),
            fallbackReason: this.readString(analysis["fallbackReason"]),
            analyzedAt: analysis["analyzedAt"] || null,
          }
        : null,
      brief: brief
        ? {
            brandId: this.readIdentifier(brief["brandId"]),
            source: this.readString(brief["source"]),
            model: this.readString(brief["model"]),
            briefTitle: this.readString(brief["briefTitle"]),
            coreAngle: this.readString(brief["coreAngle"]),
            targetAudience: this.readString(brief["targetAudience"]),
            openingHook: this.readString(brief["openingHook"]),
            scenePlan: this.readStringArray(brief["scenePlan"]),
            copyIdeas: this.readStringArray(brief["copyIdeas"]),
            brandSafetyNotes: this.readStringArray(brief["brandSafetyNotes"]),
            productionNotes: this.readStringArray(brief["productionNotes"]),
            fallbackReason: this.readString(brief["fallbackReason"]),
            generatedAt: brief["generatedAt"] || null,
          }
        : null,
    };
    const updated = await this.pipelineModel
      .findByIdAndUpdate(
        pipeline._id,
        {
          $set: {
            preferences: {
              ...currentPreferences,
              preferredStyles: mergedPreferredStyles,
              subtitlePreferences,
              remixInsights,
            },
          },
        },
        { new: true },
      )
      .lean()
      .exec();

    if (!updated) {
      throw new NotFoundException("Pipeline not found");
    }

    return {
      contentId: content._id.toString(),
      pipelineId: pipeline._id.toString(),
      preferredStyles: mergedPreferredStyles,
      subtitlePreferences,
      remixInsights,
      pipeline: updated,
    };
  }

  private async resolveAnalysis(content: LeanViralContent) {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      const fallback = this.buildAnalysisFallback(content, "no_api_key");
      this.warnFallback("analyzeViralElements", fallback.fallbackReason);
      return fallback;
    }

    try {
      return await this.generateAnalysis(content, apiKey);
    } catch (error) {
      const fallbackReason = this.buildFallbackReason(error);
      this.warnFallback("analyzeViralElements", fallbackReason, error);
      return this.buildAnalysisFallback(content, fallbackReason);
    }
  }

  private async resolveBrief(content: LeanViralContent, brand: LeanBrand) {
    const apiKey = this.getGeminiApiKey();
    if (!apiKey) {
      const fallback = this.buildBriefFallback(content, brand, "no_api_key");
      this.warnFallback("generateRemixBrief", fallback.fallbackReason);
      return fallback;
    }

    try {
      return await this.generateBrief(content, brand, apiKey);
    } catch (error) {
      const fallbackReason = this.buildFallbackReason(error);
      this.warnFallback("generateRemixBrief", fallbackReason, error);
      return this.buildBriefFallback(content, brand, fallbackReason);
    }
  }

  private async generateAnalysis(
    content: LeanViralContent,
    apiKey: string,
  ): Promise<AnalysisResultShape> {
    const fallback = this.buildAnalysisFallback(content, "partial_response");
    const completion = await this.requestStructuredCompletion(
      [
        {
          role: "system",
          content:
            "你是短视频爆款拆解策略师。请严格返回 JSON，不要输出 Markdown、解释或多余文本。",
        },
        {
          role: "user",
          content: [
            "请基于以下爆款内容，输出 JSON。字段必须完整：",
            '{"summary":"","hooks":[],"narrativeBeats":[],"structureBreakdown":[],"visualMotifs":[],"audioCues":[],"copyStyle":[],"tagStrategy":[],"bestPostingTimes":[],"ctaStyle":"","risks":[]}',
            "",
            "要求：",
            "1. structureBreakdown 需要覆盖开场钩子、价值递进、证明段、结尾 CTA。",
            "2. copyStyle 要总结文案语气、修辞、常用句式、节奏。",
            "3. tagStrategy 要给出 3-5 个标签/话题策略方向。",
            "4. bestPostingTimes 要给出 2-4 个最适合该内容的发布时间窗口。",
            "",
            this.formatViralContent(content),
          ].join("\n"),
        },
      ],
      apiKey,
    );
    const parsed = this.parseJsonPayload(completion);

    if (Object.keys(parsed).length === 0) {
      throw new Error("invalid_json_payload");
    }

    return {
      source: "vce_gemini",
      model: this.getGeminiModel(),
      contentId: content._id.toString(),
      platform: content.platform,
      videoId: content.videoId,
      title: content.title,
      summary: this.preferString(parsed["summary"], fallback.summary),
      hooks: this.preferStringArray(parsed["hooks"], fallback.hooks),
      narrativeBeats: this.preferStringArray(
        parsed["narrativeBeats"],
        fallback.narrativeBeats,
      ),
      structureBreakdown: this.preferStringArray(
        parsed["structureBreakdown"],
        fallback.structureBreakdown,
      ),
      visualMotifs: this.preferStringArray(
        parsed["visualMotifs"],
        fallback.visualMotifs,
      ),
      audioCues: this.preferStringArray(parsed["audioCues"], fallback.audioCues),
      copyStyle: this.preferStringArray(parsed["copyStyle"], fallback.copyStyle),
      tagStrategy: this.preferStringArray(
        parsed["tagStrategy"],
        fallback.tagStrategy,
      ),
      bestPostingTimes: this.preferStringArray(
        parsed["bestPostingTimes"],
        fallback.bestPostingTimes,
      ),
      ctaStyle: this.preferString(parsed["ctaStyle"], fallback.ctaStyle),
      risks: this.preferStringArray(parsed["risks"], fallback.risks),
      fallbackReason: "",
      raw: completion,
      analyzedAt: new Date(),
    };
  }

  private async generateBrief(
    content: LeanViralContent,
    brand: LeanBrand,
    apiKey: string,
  ): Promise<RemixBriefShape> {
    const fallback = this.buildBriefFallback(content, brand, "partial_response");
    const completion = await this.requestStructuredCompletion(
      [
        {
          role: "system",
          content:
            "你是品牌短视频改编导演。请严格返回 JSON，不要输出 Markdown、解释或多余文本。",
        },
        {
          role: "user",
          content: [
            "请基于以下爆款内容和品牌信息，输出 JSON。字段必须完整：",
            '{"briefTitle":"","coreAngle":"","targetAudience":"","openingHook":"","scenePlan":[],"copyIdeas":[],"brandSafetyNotes":[],"productionNotes":[]}',
            "",
            "要求：",
            "1. briefTitle 和 coreAngle 要能直接指导改编脚本。",
            "2. copyIdeas 需要结合爆款文案风格与品牌口吻。",
            "3. productionNotes 要包含标签策略和建议发布时间。",
            "",
            "[爆款内容]",
            this.formatViralContent(content),
            "",
            "[已有分析]",
            this.formatAnalysis(content.analysisResult),
            "",
            "[品牌信息]",
            this.formatBrand(brand),
          ].join("\n"),
        },
      ],
      apiKey,
    );
    const parsed = this.parseJsonPayload(completion);

    if (Object.keys(parsed).length === 0) {
      throw new Error("invalid_json_payload");
    }

    return {
      source: "vce_gemini",
      model: this.getGeminiModel(),
      contentId: content._id.toString(),
      brandId: brand._id.toString(),
      briefTitle: this.preferString(parsed["briefTitle"], fallback.briefTitle),
      coreAngle: this.preferString(parsed["coreAngle"], fallback.coreAngle),
      targetAudience: this.preferString(
        parsed["targetAudience"],
        fallback.targetAudience,
      ),
      openingHook: this.preferString(parsed["openingHook"], fallback.openingHook),
      scenePlan: this.preferStringArray(parsed["scenePlan"], fallback.scenePlan),
      copyIdeas: this.preferStringArray(parsed["copyIdeas"], fallback.copyIdeas),
      brandSafetyNotes: this.preferStringArray(
        parsed["brandSafetyNotes"],
        fallback.brandSafetyNotes,
      ),
      productionNotes: this.preferStringArray(
        parsed["productionNotes"],
        fallback.productionNotes,
      ),
      fallbackReason: "",
      raw: completion,
      generatedAt: new Date(),
    };
  }

  private async persistAnalysis(contentId: string, analysis: AnalysisResultShape) {
    await this.viralContentModel
      .findByIdAndUpdate(contentId, {
        $set: {
          analysisResult: {
            source: analysis.source,
            model: analysis.model,
            summary: analysis.summary,
            hooks: analysis.hooks,
            narrativeBeats: analysis.narrativeBeats,
            structureBreakdown: analysis.structureBreakdown,
            visualMotifs: analysis.visualMotifs,
            audioCues: analysis.audioCues,
            copyStyle: analysis.copyStyle,
            tagStrategy: analysis.tagStrategy,
            bestPostingTimes: analysis.bestPostingTimes,
            ctaStyle: analysis.ctaStyle,
            risks: analysis.risks,
            fallbackReason: analysis.fallbackReason,
            analyzedAt: analysis.analyzedAt,
          },
        },
      })
      .exec();
  }

  private async persistBrief(
    content: LeanViralContent,
    brand: LeanBrand,
    brief: RemixBriefShape,
  ) {
    const currentBriefs = Array.isArray(content.remixBriefs)
      ? content.remixBriefs
      : [];
    const nextBriefs = [
      ...currentBriefs.filter(
        (item) => this.readIdentifier(item["brandId"]) !== brand._id.toString(),
      ),
      {
        brandId: new Types.ObjectId(brand._id.toString()),
        source: brief.source,
        model: brief.model,
        briefTitle: brief.briefTitle,
        coreAngle: brief.coreAngle,
        targetAudience: brief.targetAudience,
        openingHook: brief.openingHook,
        scenePlan: brief.scenePlan,
        copyIdeas: brief.copyIdeas,
        brandSafetyNotes: brief.brandSafetyNotes,
        productionNotes: brief.productionNotes,
        fallbackReason: brief.fallbackReason,
        generatedAt: brief.generatedAt,
      },
    ];

    await this.viralContentModel
      .findByIdAndUpdate(content._id, {
        $set: {
          remixBriefs: nextBriefs,
        },
      })
      .exec();
  }

  private async getViralContent(contentId: string) {
    if (!Types.ObjectId.isValid(contentId)) {
      throw new NotFoundException("Viral content not found");
    }

    const content = (await this.viralContentModel
      .findById(contentId)
      .lean()
      .exec()) as unknown as LeanViralContent | null;
    if (!content) {
      throw new NotFoundException("Viral content not found");
    }

    return content;
  }

  private async getBrand(brandId: string) {
    if (!Types.ObjectId.isValid(brandId)) {
      throw new NotFoundException("Brand not found");
    }

    const brand = (await this.brandModel
      .findById(brandId)
      .lean()
      .exec()) as unknown as LeanBrand | null;
    if (!brand) {
      throw new NotFoundException("Brand not found");
    }

    return brand;
  }

  private async getPipeline(pipelineId: string) {
    if (!Types.ObjectId.isValid(pipelineId)) {
      throw new NotFoundException("Pipeline not found");
    }

    const pipeline = (await this.pipelineModel
      .findById(pipelineId)
      .lean()
      .exec()) as unknown as LeanPipeline | null;
    if (!pipeline) {
      throw new NotFoundException("Pipeline not found");
    }

    return pipeline;
  }

  private findBriefForBrand(content: LeanViralContent, brandId: string) {
    const briefs = Array.isArray(content.remixBriefs)
      ? content.remixBriefs
      : [];
    const matchedBrief = briefs.find(
      (item) => this.readIdentifier(item["brandId"]) === brandId,
    );
    return matchedBrief || briefs.at(-1) || null;
  }

  private async requestStructuredCompletion(
    messages: ChatMessage[],
    apiKey: string,
  ) {
    const controller = new AbortController();
    const requestTimeoutMs = this.getGeminiTimeoutMs();
    const timeout = setTimeout(() => controller.abort(), requestTimeoutMs);

    try {
      const response = await fetch(this.getGeminiEndpoint(), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.getGeminiModel(),
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages,
        }),
        signal: controller.signal,
      });
      const rawText = await response.text();

      if (!response.ok) {
        throw new Error(`request_failed_${response.status}:${rawText}`);
      }

      const payload = JSON.parse(rawText) as Record<string, any>;
      const content = payload?.["choices"]?.[0]?.["message"]?.["content"];
      if (typeof content !== "string" || !content.trim()) {
        throw new Error("empty_model_content");
      }

      return content;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`request_timeout_${requestTimeoutMs}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildAnalysisFallback(
    content: LeanViralContent,
    fallbackReason: string,
  ): AnalysisResultShape {
    return {
      source: "fallback",
      model: "fallback",
      contentId: content._id.toString(),
      platform: content.platform,
      videoId: content.videoId,
      title: content.title,
      summary: `${content.title || content.videoId} 的爆点集中在强开场、结果前置和高互动话题。`,
      hooks: [
        "前 3 秒直接给出结果或冲突",
        "标题与封面保持同一利益点",
        "评论区引导用户站队或补充经验",
      ],
      narrativeBeats: [
        "开场抛出问题或结果",
        "中段快速给出 2-3 个关键证据",
        "结尾引导用户模仿、评论或私信",
      ],
      structureBreakdown: [
        "开场 0-3 秒：先给结果或冲突，建立继续观看理由",
        "中段 4-12 秒：用场景或数据快速证明观点",
        "后段 13-20 秒：放大差异点，制造跟拍或转发动机",
        "结尾 3 秒：用提问式 CTA 拉动评论互动",
      ],
      visualMotifs: ["近景人物反应", "字幕高亮关键收益", "节奏快的镜头切换"],
      audioCues: [
        "开头用重拍点音效强调反差",
        "中段口播节奏略加快，形成推进感",
        "结尾用停顿制造评论冲动",
      ],
      copyStyle: [
        "高利益点标题，先讲结果再补证据",
        "短句密集推进，减少解释性废话",
        "多用反问、对比和数字化表达提升记忆点",
      ],
      tagStrategy: this.buildTagStrategyFallback(content),
      bestPostingTimes: this.buildPostingTimeFallback(content),
      ctaStyle: "邀请用户在评论区给出自己的选择、经验或反例",
      risks: ["避免绝对化承诺", "避免夸张前后对比无法验证"],
      fallbackReason,
      analyzedAt: new Date(),
    };
  }

  private buildBriefFallback(
    content: LeanViralContent,
    brand: LeanBrand,
    fallbackReason: string,
  ): RemixBriefShape {
    const analysis = content.analysisResult || null;
    const tagStrategy = this.readStringArray(analysis?.["tagStrategy"]);
    const postingTimes = this.readStringArray(analysis?.["bestPostingTimes"]);
    const copyStyle = this.readStringArray(analysis?.["copyStyle"]);

    return {
      source: "fallback",
      model: "fallback",
      contentId: content._id.toString(),
      brandId: brand._id.toString(),
      briefTitle: `${brand.name} 爆款改编简报`,
      coreAngle: `借用 ${content.platform} 爆款结构，把 ${brand.name} 的核心卖点前置到前 3 秒。`,
      targetAudience: brand.industry || content.industry || "泛内容消费人群",
      openingHook: `先抛出 ${brand.name} 用户最常见的一个痛点，再立刻给出反差结果。`,
      scenePlan: [
        "镜头 1: 3 秒内抛出痛点和结果",
        "镜头 2: 展示品牌解决方案的关键动作",
        "镜头 3: 用真实场景强化可信度",
        "镜头 4: 结尾导向评论或私信",
      ],
      copyIdeas: [
        `${brand.name} 为什么更容易被记住？`,
        `同样预算下，${brand.name} 的优势到底在哪？`,
        ...copyStyle.slice(0, 1).map((item) => `延续“${item}”的表达方式做品牌改写`),
      ],
      brandSafetyNotes: [
        ...(brand.assets?.prohibitedWords || []).slice(0, 3),
        "避免使用未经验证的疗效或收益承诺",
      ],
      productionNotes: [
        "保留原爆款快节奏结构，但替换成品牌真实场景",
        "字幕只保留一个主利益点，避免信息拥堵",
        ...(tagStrategy.length > 0
          ? [`标签策略优先采用：${tagStrategy.join("；")}`]
          : []),
        ...(postingTimes.length > 0
          ? [`建议发布时间：${postingTimes.join(" / ")}`]
          : []),
      ],
      fallbackReason,
      generatedAt: new Date(),
    };
  }

  private buildTagStrategyFallback(content: LeanViralContent) {
    const keywords = this.mergeUniqueStrings(content.keywords || [], []);
    const strategy = keywords.slice(0, 3).map((keyword) => `围绕“${keyword}”扩展场景词与利益词`);

    if (content.industry) {
      strategy.push(`补充 ${content.industry} 行业通用问题词，扩大搜索命中`);
    }

    if (strategy.length === 0) {
      strategy.push("使用痛点词 + 场景词 + 结果词三段式标签组合");
    }

    return strategy;
  }

  private buildPostingTimeFallback(content: LeanViralContent) {
    const windows = ["工作日 12:00-13:30", "工作日 19:30-21:30"];
    const publishedAt = this.toDate(content.publishedAt);

    if (!publishedAt) {
      return windows;
    }

    const weekdayNames = [
      "周日",
      "周一",
      "周二",
      "周三",
      "周四",
      "周五",
      "周六",
    ];
    const hour = publishedAt.getHours();
    const nextHour = `${(hour + 2) % 24}`.padStart(2, "0");
    const primaryWindow = `${weekdayNames[publishedAt.getDay()]} ${`${hour}`.padStart(2, "0")}:00-${nextHour}:00`;

    return this.mergeUniqueStrings([primaryWindow], windows);
  }

  private formatViralContent(content: LeanViralContent) {
    return [
      `平台: ${content.platform}`,
      `视频ID: ${content.videoId}`,
      `标题: ${content.title || ""}`,
      `作者: ${content.author || ""}`,
      `行业: ${content.industry || ""}`,
      `关键词: ${(content.keywords || []).join(", ")}`,
      `发布时间: ${content.publishedAt?.toISOString?.() || ""}`,
      `播放: ${content.views || 0}`,
      `点赞: ${content.likes || 0}`,
      `评论: ${content.comments || 0}`,
      `分享: ${content.shares || 0}`,
      `爆款分: ${content.viralScore || 0}`,
      `链接: ${content.contentUrl || ""}`,
    ].join("\n");
  }

  private formatAnalysis(analysis?: Record<string, unknown> | null) {
    if (!analysis) {
      return "暂无现成分析，可根据原始内容直接生成品牌改编简报。";
    }

    return [
      `总结: ${this.readString(analysis["summary"])}`,
      `结构拆解: ${this.readStringArray(analysis["structureBreakdown"]).join("；")}`,
      `文案风格: ${this.readStringArray(analysis["copyStyle"]).join("；")}`,
      `标签策略: ${this.readStringArray(analysis["tagStrategy"]).join("；")}`,
      `最佳发布时间: ${this.readStringArray(analysis["bestPostingTimes"]).join(" / ")}`,
    ].join("\n");
  }

  private formatBrand(brand: LeanBrand) {
    return [
      `品牌名: ${brand.name}`,
      `行业: ${brand.industry || ""}`,
      `品牌关键词: ${(brand.assets?.keywords || []).join(", ")}`,
      `口号: ${(brand.assets?.slogans || []).join(", ")}`,
      `禁用词: ${(brand.assets?.prohibitedWords || []).join(", ")}`,
    ].join("\n");
  }

  private getGeminiApiKey() {
    return this.configService.getString([
      "VCE_GEMINI_API_KEY",
      "MEDIACLAW_VCE_API_KEY",
    ]);
  }

  private getGeminiEndpoint() {
    return this.configService.getString(
      ["VCE_GEMINI_ENDPOINT"],
      this.defaultEndpoint,
    );
  }

  private getGeminiModel() {
    return this.configService.getString(["VCE_GEMINI_MODEL"], this.defaultModel);
  }

  private getGeminiTimeoutMs() {
    return this.configService.getNumber(
      ["VCE_GEMINI_TIMEOUT_MS"],
      this.defaultRequestTimeoutMs,
    );
  }

  private warnFallback(method: string, reason: string, error?: unknown) {
    const suffix = error instanceof Error ? ` (${error.name})` : "";
    this.logger.warn(`${method} fallback engaged: ${reason}${suffix}`);
  }

  private buildFallbackReason(error: unknown) {
    if (error instanceof Error) {
      return error.message.slice(0, 200);
    }

    return "unknown_error";
  }

  private parseJsonPayload(content: string) {
    const normalized = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    try {
      return JSON.parse(normalized) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private toDate(value: unknown) {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    if (typeof value === "string" || typeof value === "number") {
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }

    return null;
  }

  private preferString(value: unknown, fallback: string) {
    return this.readString(value) || fallback;
  }

  private preferStringArray(value: unknown, fallback: string[]) {
    const next = this.readStringArray(value);
    return next.length > 0 ? next : fallback;
  }

  private readString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
  }

  private readIdentifier(value: unknown) {
    if (typeof value === "string") {
      return value.trim();
    }

    if (
      value &&
      typeof value === "object" &&
      "toString" in value &&
      typeof value["toString"] === "function"
    ) {
      return value.toString();
    }

    return "";
  }

  private readStringArray(value: unknown) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private mergeUniqueStrings(primary: string[], secondary: string[]) {
    return Array.from(
      new Set(
        [...primary, ...secondary]
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }
}
