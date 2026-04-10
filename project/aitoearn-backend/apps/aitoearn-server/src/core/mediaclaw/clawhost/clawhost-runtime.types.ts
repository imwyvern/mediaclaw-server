export enum ClawHostRuntimeKind {
  DOCKER = 'docker',
  K8S = 'k8s',
}

export interface CreateManagedRuntimeInput {
  instanceId: string
  orgId: string
  plan: string
  clientName: string
  skillVersion: string
  preferredPort?: number
  namespace?: string
  podName?: string
  config?: {
    cpu?: string
    memory?: string
    storage?: string
  }
}

export interface ManagedRuntimeRecord {
  runtimeKind: ClawHostRuntimeKind
  containerId: string
  containerName: string
  image: string
  hostPort: number
  accessUrl: string
  healthUrl: string
  namespace?: string
  podName?: string
}

export interface ManagedRuntimeState {
  exists: boolean
  running: boolean
  status: string
  healthUrl: string
  apiHealthy: boolean
  latencyMs: number
  errorMessage: string
}

export interface ManagedRuntimeTarget {
  runtimeKind: ClawHostRuntimeKind
  containerId: string
  containerName?: string
  namespace?: string
  podName?: string
  healthUrl?: string
}

export interface ClawHostRuntimeDriver {
  readonly kind: ClawHostRuntimeKind
  createManagedRuntime: (input: CreateManagedRuntimeInput) => Promise<ManagedRuntimeRecord>
  start: (target: ManagedRuntimeTarget) => Promise<void>
  stop: (target: ManagedRuntimeTarget) => Promise<void>
  restart: (target: ManagedRuntimeTarget) => Promise<void>
  upgradeSkill: (target: ManagedRuntimeTarget, version: string) => Promise<void>
  inspect: (target: ManagedRuntimeTarget) => Promise<ManagedRuntimeState>
  getLogs: (target: ManagedRuntimeTarget, tail: number) => Promise<string[]>
}

export function buildClawHostBootstrapScript() {
  return [
    `const fs=require('fs');`,
    `const http=require('http');`,
    `const port=Number(process.env.PORT||3000);`,
    `const payload={status:'ok',instanceId:process.env.MEDIACLAW_INSTANCE_ID||'',orgId:process.env.MEDIACLAW_ORG_ID||'',plan:process.env.MEDIACLAW_PLAN||'',skillVersion:process.env.MEDIACLAW_SKILL_VERSION||'latest'};`,
    `fs.mkdirSync('/opt/mediaclaw/skills',{recursive:true});`,
    `fs.writeFileSync('/opt/mediaclaw/skills/mediaclaw-client.version',payload.skillVersion);`,
    `http.createServer((req,res)=>{res.setHeader('content-type','application/json');if(req.url==='/health'){res.end(JSON.stringify(payload));return;}res.end(JSON.stringify({service:'mediaclaw-client',...payload}));}).listen(port,'0.0.0.0');`,
    `setInterval(()=>{},2147483647);`,
  ].join('')
}
