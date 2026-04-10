import { Injectable } from '@nestjs/common'
import OSS from 'ali-oss'

export interface OssLifecycleConnectionConfig {
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  region: string
  endpoint?: string
  secure?: boolean
  internal?: boolean
  timeout?: string | number
  cname?: boolean
}

export interface OssLifecycleExpirationRule {
  days: string
}

export interface OssLifecycleAbortMultipartUploadRule {
  days: string
}

export interface OssLifecycleTransitionRule {
  days: string
  storageClass: 'IA' | 'Archive' | 'ColdArchive' | 'DeepColdArchive'
}

export interface OssLifecycleRule {
  id: string
  prefix: string
  status: 'Enabled' | 'Disabled'
  expiration?: OssLifecycleExpirationRule
  abortMultipartUpload?: OssLifecycleAbortMultipartUploadRule
  transition?: OssLifecycleTransitionRule
}

export interface OssLifecycleClient {
  putBucketLifecycle: (bucket: string, rules: OssLifecycleRule[]) => Promise<unknown>
  getBucketLifecycle: (bucket: string) => Promise<{ rules?: OssLifecycleRule[] }>
}

@Injectable()
export class OssLifecycleClientFactory {
  create(config: OssLifecycleConnectionConfig): OssLifecycleClient {
    const client = new OSS({
      accessKeyId: config.accessKeyId,
      accessKeySecret: config.accessKeySecret,
      bucket: config.bucket,
      region: config.region,
      endpoint: config.endpoint,
      secure: config.secure,
      internal: config.internal,
      timeout: config.timeout,
      cname: config.cname,
    })

    return {
      putBucketLifecycle: async (bucket, rules) =>
        await (client as any).putBucketLifecycle(bucket, rules),
      getBucketLifecycle: async bucket =>
        await (client as any).getBucketLifecycle(bucket),
    }
  }
}
