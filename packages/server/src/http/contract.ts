import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Scope } from '@everylocale/store';
import type { Identity } from './auth.js';

/** Who may call an endpoint; a scope means an owner credential or a project token with it. */
type Access = 'public' | 'signed-in' | 'owner' | Scope;

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Fields = z.ZodObject;

export type Endpoint<
  Params extends Fields | undefined = Fields | undefined,
  Query extends Fields | undefined = Fields | undefined,
  Body extends z.ZodType | undefined = z.ZodType | undefined,
  Headers extends Fields | undefined = Fields | undefined,
  Response extends z.ZodType = z.ZodType,
> = {
  method: Method;
  /** OpenAPI path template, such as `/api/v1/projects/{project}`. */
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tag: string;
  access: Access;
  /** Completes "Only the owner can ..." when an owner endpoint refuses a project token. */
  ownerAction?: string;
  params?: Params;
  query?: Query;
  body?: Body;
  headers?: Headers;
  response: Response;
};

type Parsed<Schema> = Schema extends z.ZodType ? z.output<Schema> : undefined;

type Input<E extends Endpoint> = {
  params: Parsed<E['params']>;
  query: Parsed<E['query']>;
  body: Parsed<E['body']>;
  headers: Parsed<E['headers']>;
  /** The caller, already checked against `access`; undefined on public endpoints. */
  user: E['access'] extends 'public' ? undefined : Identity;
};

/** Checks a request against an endpoint's declared access before its body is parsed. */
export type Authorize = (
  request: FastifyRequest,
  endpoint: Endpoint,
  params: Record<string, unknown> | undefined,
) => Identity | undefined;

export type Handler<E extends Endpoint> = (
  input: Input<E>,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<z.input<E['response']>> | z.input<E['response']>;

/**
 * The one place an HTTP endpoint is declared. Its schemas parse every request, check every
 * response when `validateResponses` is on (development and tests), and generate the OpenAPI
 * document, so the published contract cannot drift from the code that serves it.
 */
export class Api {
  readonly endpoints: Endpoint[] = [];

  constructor(
    /** Only route registration is needed, so any host with Fastify's `route` works. */
    private readonly app: Pick<FastifyInstance, 'route'>,
    private readonly authorize: Authorize,
    private readonly validateResponses: boolean,
  ) {}

  route<E extends Endpoint>(endpoint: E, handler: Handler<E>): void {
    if (this.endpoints.some((item) => item.operationId === endpoint.operationId))
      throw new Error(`Duplicate operation ${endpoint.operationId}`);
    this.endpoints.push(endpoint);
    this.app.route({
      method: endpoint.method,
      url: endpoint.path.replace(/\{(\w+)\}/g, ':$1'),
      handler: async (request, reply) => {
        // Path parameters name the project to authorize against; the query and body are parsed
        // only for an authorized caller, so validation errors never reach anonymous callers.
        const params = endpoint.params?.parse(request.params);
        const user = this.authorize(request, endpoint, params);
        const input = {
          params,
          user,
          query: endpoint.query?.parse(request.query),
          body: endpoint.body?.parse(request.body),
          headers: endpoint.headers?.parse(request.headers),
        } as Input<E>;
        const result = await handler(input, request, reply);
        if (this.validateResponses) {
          const checked = endpoint.response.safeParse(result);
          if (!checked.success)
            throw new ResponseContractError(endpoint.operationId, checked.error);
        }
        return result;
      },
    });
  }
}

/** A handler returned something its declared response schema does not describe. */
export class ResponseContractError extends Error {
  constructor(operationId: string, error: z.ZodError) {
    super(
      `${operationId} returned a response outside its contract: ${error.issues
        .map((issue) => `${issue.path.join('.') || 'response'} ${issue.message}`)
        .join('; ')}`,
    );
  }
}

const errorSchema = z
  .object({
    error: z.object({
      code: z.string().describe('Stable machine-readable code, such as `validation`.'),
      message: z.string(),
      fields: z.array(z.string()).optional().describe('Invalid request fields, for `validation`.'),
      requestId: z.string().optional(),
    }),
  })
  .meta({ id: 'Error' });

const ACCESS_TEXT: Record<Access, string> = {
  public: 'No credentials.',
  'signed-in': 'Any valid credential.',
  owner: 'The owner token or an owner session.',
  read: 'A credential with the `read` scope.',
  import: 'A credential with the `import` scope.',
  translate: 'A credential with the `translate` scope.',
  review: 'A credential with the `review` scope.',
  approve: 'A credential with the `approve` scope.',
  export: 'A credential with the `export` scope.',
};

const jsonSchema = (schema: z.ZodType, io: 'input' | 'output') =>
  z.toJSONSchema(schema, {
    io,
    target: 'draft-2020-12',
    unrepresentable: 'any',
  }) as Record<string, unknown>;

/**
 * Moves `$defs` (schemas registered with `.meta({ id })`) into shared components, so each named
 * schema is described once. The document declares the dialect once for all schemas.
 */
function hoist(schema: Record<string, unknown>, components: Record<string, unknown>) {
  const rewritten = JSON.parse(
    JSON.stringify(schema).replaceAll('"#/$defs/', '"#/components/schemas/'),
  ) as { $defs?: Record<string, unknown>; $schema?: string } & Record<string, unknown>;
  const { $defs, $schema: _dialect, ...rest } = rewritten;
  for (const [name, definition] of Object.entries($defs ?? {})) {
    // A named schema used as both input and output can render differently (defaults make
    // fields optional on input); one name must mean one shape.
    const existing = components[name];
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(definition))
      throw new Error(`Schema ${name} renders differently in two places`);
    components[name] = definition;
  }
  return rest;
}

/** OpenAPI 3.1 for every declared endpoint, in declaration order. */
export function openApiDocument(endpoints: readonly Endpoint[], version: string) {
  const schemas: Record<string, unknown> = {};
  const paths: Record<string, Record<string, unknown>> = {};
  const error = hoist(jsonSchema(errorSchema, 'output'), schemas);
  for (const endpoint of endpoints) {
    const parameters = (['path', 'query', 'header'] as const).flatMap((location) => {
      const fields = { path: endpoint.params, query: endpoint.query, header: endpoint.headers }[
        location
      ];
      if (!fields) return [];
      const object = hoist(jsonSchema(fields, 'input'), schemas) as {
        properties?: Record<string, Record<string, unknown>>;
        required?: string[];
      };
      return Object.entries(object.properties ?? {}).map(([name, schema]) => {
        const { description, ...rest } = schema;
        return {
          name,
          in: location,
          required: location === 'path' || (object.required ?? []).includes(name),
          ...(description ? { description } : {}),
          schema: rest,
        };
      });
    });
    const operation: Record<string, unknown> = {
      operationId: endpoint.operationId,
      summary: endpoint.summary,
      description: [endpoint.description, `Access: ${ACCESS_TEXT[endpoint.access]}`]
        .filter(Boolean)
        .join('\n\n'),
      tags: [endpoint.tag],
      ...(endpoint.access === 'public' ? { security: [] } : {}),
      ...(parameters.length ? { parameters } : {}),
      ...(endpoint.body
        ? {
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: hoist(jsonSchema(endpoint.body, 'input'), schemas) },
              },
            },
          }
        : {}),
      responses: {
        '200': {
          description: 'Success',
          content: {
            'application/json': {
              schema: hoist(jsonSchema(endpoint.response, 'output'), schemas),
            },
          },
        },
        default: {
          description: 'An error, with a stable code',
          content: { 'application/json': { schema: error } },
        },
      },
    };
    (paths[endpoint.path] ??= {})[endpoint.method.toLowerCase()] = operation;
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'EveryLocale API',
      version,
      license: { name: 'MIT', identifier: 'MIT' },
      description:
        'Self-hosted localization service. Requests authenticate with a bearer token, or with the workspace session cookie plus the `x-csrf-token` header for changes.',
    },
    servers: [{ url: '/' }],
    security: [{ bearer: [] }, { session: [] }],
    tags: [...new Set(endpoints.map((item) => item.tag))].map((name) => ({ name })),
    paths,
    components: {
      schemas,
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'Owner token or project token' },
        session: { type: 'apiKey', in: 'cookie', name: 'el_session' },
      },
    },
  };
}
