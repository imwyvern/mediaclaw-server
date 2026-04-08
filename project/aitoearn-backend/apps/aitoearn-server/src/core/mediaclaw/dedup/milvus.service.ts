import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common'
import { ConsistencyLevelEnum, DataType, MilvusClient } from '@zilliz/milvus2-sdk-node'

interface MilvusInsertData {
  record_id: number
  project_id: string
  url: string
  embedding: number[]
  created_at: number
}

interface MilvusSearchResult {
  id: number
  record_id: number
  project_id: string
  url: string
  score: number
}

@Injectable()
export class MilvusService implements OnModuleDestroy {
  private readonly logger = new Logger(MilvusService.name)
  private client: MilvusClient | null = null
  private readonly ensuredCollections = new Set<string>()

  private getClient(): MilvusClient | null {
    if (this.client) {
      return this.client
    }

    const address = process.env['MILVUS_ADDRESS'] || 'localhost:19530'
    const token = process.env['MILVUS_TOKEN'] || ''

    try {
      this.client = new MilvusClient({ address, token: token || undefined })
      this.logger.log(`Milvus client initialized at ${address}`)
      return this.client
    }
    catch (error) {
      this.logger.warn(`Failed to initialize Milvus client: ${(error as Error).message}`)
      return null
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      try {
        await this.client.closeConnection()
      }
      catch {
        // ignore close errors
      }

      this.client = null
    }
  }

  async ensureCollection(projectId: string): Promise<boolean> {
    const client = this.getClient()
    if (!client) {
      this.logger.warn('Milvus client not available, skipping collection creation')
      return false
    }

    const collectionName = this.getCollectionName(projectId)
    if (this.ensuredCollections.has(collectionName)) {
      return true
    }

    try {
      const hasCollection = await client.hasCollection({ collection_name: collectionName })
      if (hasCollection.value) {
        this.ensuredCollections.add(collectionName)
        return true
      }

      await client.createCollection({
        collection_name: collectionName,
        fields: [
          {
            name: 'id',
            data_type: DataType.Int64,
            is_primary_key: true,
            autoID: true,
          },
          {
            name: 'record_id',
            data_type: DataType.Int64,
          },
          {
            name: 'project_id',
            data_type: DataType.VarChar,
            max_length: 64,
          },
          {
            name: 'url',
            data_type: DataType.VarChar,
            max_length: 1024,
          },
          {
            name: 'embedding',
            data_type: DataType.FloatVector,
            dim: 2048,
          },
          {
            name: 'created_at',
            data_type: DataType.Int64,
          },
        ],
      })

      await client.createIndex({
        collection_name: collectionName,
        field_name: 'embedding',
        index_type: 'HNSW',
        metric_type: 'COSINE',
        params: { M: 16, efConstruction: 256 },
      })

      await client.loadCollectionSync({ collection_name: collectionName })

      this.ensuredCollections.add(collectionName)
      this.logger.log(`Created and loaded Milvus collection: ${collectionName}`)
      return true
    }
    catch (error) {
      this.logger.error(`Failed to ensure Milvus collection ${collectionName}: ${(error as Error).message}`)
      return false
    }
  }

  async search(projectId: string, embedding: number[], topK = 5): Promise<MilvusSearchResult[]> {
    const client = this.getClient()
    if (!client) {
      return []
    }

    const collectionName = this.getCollectionName(projectId)
    const ready = await this.ensureCollection(projectId)
    if (!ready) {
      return []
    }

    try {
      const result = await client.search({
        collection_name: collectionName,
        data: [embedding],
        limit: topK,
        output_fields: ['record_id', 'project_id', 'url'],
        params: { ef: 64 },
        consistency_level: ConsistencyLevelEnum.Bounded,
      })

      if (!result.results || result.results.length === 0) {
        return []
      }

      return result.results.map(hit => ({
        id: Number(hit['id'] ?? 0),
        record_id: Number(hit['record_id'] ?? 0),
        project_id: String(hit['project_id'] ?? ''),
        url: String(hit['url'] ?? ''),
        score: Number(hit['score'] ?? 0),
      }))
    }
    catch (error) {
      this.logger.error(`Milvus search failed for ${collectionName}: ${(error as Error).message}`)
      return []
    }
  }

  async insert(projectId: string, data: MilvusInsertData): Promise<boolean> {
    const client = this.getClient()
    if (!client) {
      return false
    }

    const collectionName = this.getCollectionName(projectId)
    const ready = await this.ensureCollection(projectId)
    if (!ready) {
      return false
    }

    try {
      await client.insert({
        collection_name: collectionName,
        data: [
          {
            record_id: data.record_id,
            project_id: data.project_id,
            url: data.url,
            embedding: data.embedding,
            created_at: data.created_at,
          },
        ],
      })

      return true
    }
    catch (error) {
      this.logger.error(`Milvus insert failed for ${collectionName}: ${(error as Error).message}`)
      return false
    }
  }

  private getCollectionName(projectId: string): string {
    const sanitized = projectId.replace(/\W/g, '_').slice(0, 48)
    return `content_dedup_${sanitized}`
  }
}
