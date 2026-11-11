import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LocalizationStore } from '@everylocale/store';
import type { ChatGptConnection } from '../chatgpt.js';
import type { ProviderPause } from '../worker.js';
import type { Auth } from './auth.js';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type AppConfig = {
  adminToken: string;
  sessionSecret: string;
  publicOrigin: string;
  secureCookie: boolean;
  providersReady: boolean;
  logLevel: LogLevel;
  /** Proxy addresses or CIDR ranges whose forwarded client address is trusted; false trusts none. */
  trustProxy: string | false;
  connection?: ChatGptConnection;
  /** Pause status and resume control of the translation worker, when providers are configured. */
  providers?: {
    status(): { paused: ProviderPause | null } | null;
    resume(): void;
  };
};

export type RouteContext = {
  app: FastifyInstance;
  store: LocalizationStore;
  config: AppConfig;
  auth: Auth;
  /** Nonce for the workspace's inline preview styles, fixed for the process. */
  styleNonce: string;
};

const projectParams = z.object({ project: z.string() });
const idParams = z.object({ id: z.string() });
export const projectId = (request: FastifyRequest) => projectParams.parse(request.params).project;
export const itemId = (request: FastifyRequest) => idParams.parse(request.params).id;
