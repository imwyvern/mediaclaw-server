# b9-product-showcase

适用场景：高质量产品展示、品牌号对标复刻。

标准流程：
1. 对标参考视频
2. 自动或手动分镜拆解
3. 逐镜 Gemini 换品首帧并启用 Style Rewrite
4. Kling 链式 i2v 生成
5. 提取原视频音频并叠字幕
6. FFmpeg 拼接镜头
7. 标题同义改写和标签生成
8. 生成后向量查重
