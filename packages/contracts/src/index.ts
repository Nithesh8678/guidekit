import { z } from 'zod';

export const idSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
export const originSchema = z.string().url().refine(value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && u.origin === value; } catch { return false; }
}, 'Use an exact origin, for example http://127.0.0.1:4411');
export const agentConfigSchema = z.object({
  name: z.string().trim().min(2).max(80),
  companyName: z.string().trim().min(2).max(100),
  description: z.string().max(1500).default(''),
  instructions: z.string().max(6000).default('Be concise, helpful, and grounded in the company knowledge.'),
  greeting: z.string().max(250).default('What would you like to do?'),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#365cf5'),
  allowedOrigins: z.array(originSchema).min(1).max(12),
  allowedActions: z.array(idSchema).max(30).default([])
}).strict();
export type AgentConfig = z.infer<typeof agentConfigSchema>;
export interface Agent extends AgentConfig { id: string; tenantId: string; createdAt: string; updatedAt: string; publishedVersion: number | null; }
export interface KnowledgeDocument { id: string; title: string; content: string; createdAt: string; }
export type VersionStatus = 'preparing' | 'syncing' | 'ready' | 'failed';
export interface AgentVersion { number: number; createdAt: string; documentCount: number; status: VersionStatus; graphSource: 'local' | 'tigergraph'; error?: string; completedAt?: string; }
export interface PublicAgent { id: string; version: number; name: string; companyName: string; greeting: string; accentColor: string; allowedActions: string[]; }
export interface Citation { documentId: string; title: string; excerpt: string; }

export const pageTargetSchema = z.object({
  id: idSchema, label: z.string().max(160), role: z.string().max(40),
  description: z.string().max(250).optional()
}).strict();
export const actionDescriptorSchema = z.object({
  name: idSchema, description: z.string().max(500),
  inputSchema: z.record(z.string(), z.unknown()), requiresConfirmation: z.boolean()
}).strict();
export const pageContextSchema = z.object({
  url: z.string().url().max(1800), title: z.string().max(200),
  targets: z.array(pageTargetSchema).max(80),
  actions: z.array(actionDescriptorSchema).max(30),
  context: z.record(z.string(), z.unknown()).default({})
}).strict();
export type PageContext = z.infer<typeof pageContextSchema>;
export type PageTarget = z.infer<typeof pageTargetSchema>;

export const journeyRequestSchema = z.object({
  id: idSchema, revision: z.number().int().min(0).max(100), goal: z.string().trim().min(1).max(1000),
  reason: z.enum(['initial', 'scene_changed', 'target_missing', 'segment_completed', 'user_resume']),
  completed: z.array(z.object({ targetId: idSchema, label: z.string().max(160), role: z.string().max(40), evidence: z.enum(['observed', 'manual', 'host_verified']) }).strict()).max(24)
}).strict();
export type JourneyRequest = z.infer<typeof journeyRequestSchema>;
export interface JourneyResult { id: string; revision: number; disposition: 'continue' | 'needs_input' | 'done'; }
export type ModelProviderId = 'codex' | 'openai';

export const annotationKindSchema = z.enum(['target', 'ring', 'frame', 'arrow', 'underline', 'number']);
export const guideStepSchema = z.object({ targetId: idSchema, text: z.string().min(1).max(600), annotation: annotationKindSchema.optional() }).strict();
export const proposedActionSchema = z.object({ name: idSchema, arguments: z.record(z.string(), z.unknown()), reason: z.string().max(600) }).strict();
export const modelPlanSchema = z.object({
  answer: z.string().min(1).max(5000),
  steps: z.array(guideStepSchema).max(8),
  action: proposedActionSchema.nullable(),
  citationIds: z.array(idSchema).max(8),
  journeyDisposition: z.enum(['continue', 'needs_input', 'done']).optional()
}).strict();
export type ModelPlan = z.infer<typeof modelPlanSchema>;
export interface KnowledgePath { nodes: string[]; relation: string; }
export interface RunResult { runId: string; answer: string; steps: ModelPlan['steps']; action: (NonNullable<ModelPlan['action']> & { receiptId: string; requiresConfirmation: true }) | null; citations: Citation[]; provider: ModelProviderId; version: number; knowledge?: { source: 'tigergraph' | 'local'; paths: KnowledgePath[] }; journey?: JourneyResult; }
export interface RunSummary { id: string; question: string; answer: string; status: string; createdAt: string; actionName: string | null; }
export interface AgentDetail { agent: Agent; documents: KnowledgeDocument[]; versions: AgentVersion[]; sessions: RunSummary[]; }
export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';
export interface Workspace { user: { id: string; email: string; name: string; emailVerified?: boolean }; tenant: { id: string; name: string }; role?: WorkspaceRole; }
export interface RuntimeStatus { provider: ModelProviderId; available: boolean; authenticated: boolean; message: string; }

export const askSchema = z.object({
  message: z.string().trim().min(1).max(3000), page: pageContextSchema,
  requestId: idSchema, journey: journeyRequestSchema.optional()
}).strict();
export const actionResultSchema = z.object({
  receiptId: idSchema, status: z.enum(['succeeded', 'failed', 'cancelled']),
  message: z.string().max(1000)
}).strict();
