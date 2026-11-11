import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { LocalizationStore } from '@everylocale/store';
import type { ChatGptConnection } from '../chatgpt.js';
import type { ProviderPause } from '../worker.js';
import type { Auth } from './auth.js';
import type { Api } from './contract.js';

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
  /** Check every response against the endpoint's schema; on unless set to false. */
  validateResponses?: boolean;
  connection?: ChatGptConnection;
  /** Pause status and resume control of the translation worker, when providers are configured. */
  providers?: {
    status(): { paused: ProviderPause | null } | null;
    resume(): void;
  };
};

export type RouteContext = {
  app: FastifyInstance;
  /** Declares endpoints with their schemas; see `Api`. */
  api: Api;
  store: LocalizationStore;
  config: AppConfig;
  auth: Auth;
  /** Nonce for the workspace's inline preview styles, fixed for the process. */
  styleNonce: string;
};

const projectId = z.string().describe('Project id');
/** Path parameters shared by project endpoints. */
export const projectParams = z.object({ project: projectId });
export const projectItemParams = z.object({ project: projectId, id: z.string() });
export const projectLocaleParams = z.object({ project: projectId, locale: z.string() });
