import { PRODUCT_NAME } from "@/config/platform";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

const SPACE_PARAM = {
  name: "spaceId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

const CUBE_PARAM = {
  name: "cubeId",
  in: "path",
  required: true,
  schema: { type: "string" },
} as const;

const IDEMPOTENCY_HEADER = {
  name: "Idempotency-Key",
  in: "header",
  required: false,
  description:
    "Optional unique key (max 255 chars). Replays return the original response and add header Idempotency-Replayed: true. Scoped per space; expires after 24h.",
  schema: { type: "string", maxLength: 255 },
} as const;

function buildSpec(baseUrl: string) {
  return {
    openapi: "3.1.0",
    info: {
      title: `${PRODUCT_NAME} API`,
      version: "1.0.0",
      description:
        `Programmatic access to ${PRODUCT_NAME}. Authenticate with the ` +
        "X-API-KEY header. Keys are scoped per Space and inherit the " +
        "permissions of the membership that created them. Mutating POST " +
        "/ DELETE endpoints are rate-limited to 10 requests per 60 " +
        "seconds per client IP.",
      contact: { email: "support@krova.cloud" },
    },
    servers: [{ url: `${baseUrl}/api/v1` }],
    security: [{ ApiKeyAuth: [] }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "X-API-KEY",
        },
      },
      schemas: {
        Cube: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            spaceId: { type: "string" },
            status: {
              type: "string",
              enum: [
                "pending",
                "booting",
                "running",
                "sleeping",
                "stopping",
                "error",
                "deleted",
              ],
            },
            vcpus: { type: "integer" },
            ramMb: { type: "integer" },
            diskLimitGb: { type: "integer" },
            imageId: { type: "string" },
            publicIpv4: { type: "string", nullable: true },
            costPerHour: { type: "number" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        Domain: {
          type: "object",
          properties: {
            id: { type: "string" },
            hostname: { type: "string" },
            cubeId: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        TcpMapping: {
          type: "object",
          properties: {
            id: { type: "string" },
            cubeId: { type: "string" },
            cubePort: { type: "integer" },
            publicPort: { type: "integer" },
            whitelistIps: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
        Snapshot: {
          type: "object",
          properties: {
            id: { type: "string" },
            cubeId: { type: "string" },
            name: { type: "string" },
            sizeBytes: { type: "integer", nullable: true },
            status: { type: "string" },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Webhook: {
          type: "object",
          properties: {
            id: { type: "string" },
            url: { type: "string", format: "uri" },
            events: {
              type: "array",
              items: {
                type: "string",
                enum: [
                  "cube.running",
                  "cube.sleeping",
                  "cube.error",
                  "cube.deleted",
                ],
              },
            },
            enabled: { type: "boolean" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        WebhookDelivery: {
          type: "object",
          properties: {
            id: { type: "string" },
            event: { type: "string" },
            status: {
              type: "string",
              enum: ["pending", "delivered", "failed"],
            },
            attempts: { type: "integer" },
            lastAttemptAt: {
              type: "string",
              format: "date-time",
              nullable: true,
            },
            responseStatus: { type: "integer", nullable: true },
            createdAt: { type: "string", format: "date-time" },
          },
        },
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
        },
      },
      responses: {
        BadRequest: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        Unauthorized: {
          description: "Missing or invalid API key",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        Forbidden: {
          description: "Authenticated but lacks the required permission",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        NotFound: {
          description: "Resource not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
        RateLimited: {
          description: "Rate limit exceeded (10 mutations / 60s)",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Error" },
            },
          },
        },
      },
    },
    paths: {
      "/regions": {
        get: {
          summary: "List regions with available capacity",
          security: [],
          tags: ["Public"],
          responses: {
            "200": {
              description: "Region list",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/images": {
        get: {
          summary: "List available OS images",
          security: [],
          tags: ["Public"],
          responses: {
            "200": {
              description: "Image list",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/pricing": {
        get: {
          summary: "Per-resource hourly rates and volume pricing tiers",
          security: [],
          tags: ["Public"],
          responses: {
            "200": {
              description: "Pricing data",
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
        },
      },
      "/spaces/{spaceId}/cubes": {
        get: {
          summary: "List Cubes in a Space",
          tags: ["Cubes"],
          parameters: [SPACE_PARAM],
          responses: {
            "200": {
              description: "Paginated Cube list",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
          },
        },
        post: {
          summary: "Create a Cube",
          tags: ["Cubes"],
          parameters: [SPACE_PARAM, IDEMPOTENCY_HEADER],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "image", "resources", "sshPublicKey"],
                  properties: {
                    name: { type: "string" },
                    image: { type: "string" },
                    resources: {
                      type: "object",
                      required: ["vcpu", "ramGb", "diskGb"],
                      properties: {
                        vcpu: { type: "number" },
                        ramGb: { type: "number" },
                        diskGb: { type: "number" },
                      },
                    },
                    sshPublicKey: {
                      type: "string",
                      description:
                        "SSH public key written to /root/.ssh/authorized_keys at boot. Must start with ssh-ed25519, ssh-rsa, ecdsa-sha2-*, ssh-dss, or sk-*@openssh.com.",
                    },
                    region: {
                      type: "string",
                      description: "Region slug from /v1/regions (optional).",
                    },
                    userData: {
                      type: "string",
                      description: "cloud-init script (max 16 KB, optional).",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Cube created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      cube: { $ref: "#/components/schemas/Cube" },
                    },
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "403": { $ref: "#/components/responses/Forbidden" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}": {
        get: {
          summary: "Get a Cube",
          tags: ["Cubes"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          responses: {
            "200": {
              description: "Cube",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          summary: "Delete a Cube (asynchronous)",
          tags: ["Cubes"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          responses: {
            "200": {
              description: "Deletion enqueued",
              content: { "application/json": { schema: { type: "object" } } },
            },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/sleep": {
        post: {
          summary: "Sleep a running Cube",
          tags: ["Cubes"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          responses: {
            "200": { description: "Sleep enqueued" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/wake": {
        post: {
          summary: "Wake a sleeping Cube",
          tags: ["Cubes"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          responses: {
            "200": { description: "Wake enqueued" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/domains": {
        get: {
          summary: "List custom domains attached to a Cube",
          tags: ["Domains"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          responses: {
            "200": { description: "Domain list" },
          },
        },
        post: {
          summary: "Attach a custom domain to a Cube",
          tags: ["Domains"],
          parameters: [SPACE_PARAM, CUBE_PARAM, IDEMPOTENCY_HEADER],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["hostname"],
                  properties: { hostname: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": { description: "Domain attached" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/domains/{mappingId}": {
        delete: {
          summary: "Detach a custom domain",
          tags: ["Domains"],
          parameters: [
            SPACE_PARAM,
            CUBE_PARAM,
            {
              name: "mappingId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Detached" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/tcp-mappings": {
        get: {
          summary: "List TCP port forwards for a Cube",
          tags: ["TCP mappings"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          responses: { "200": { description: "TCP mapping list" } },
        },
        post: {
          summary: "Create a TCP port forward",
          tags: ["TCP mappings"],
          parameters: [SPACE_PARAM, CUBE_PARAM, IDEMPOTENCY_HEADER],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["cubePort"],
                  properties: {
                    cubePort: { type: "integer" },
                    whitelistIps: {
                      type: "array",
                      items: { type: "string" },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": { description: "Mapping created" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/tcp-mappings/{mappingId}": {
        delete: {
          summary: "Delete a TCP port forward",
          tags: ["TCP mappings"],
          parameters: [
            SPACE_PARAM,
            CUBE_PARAM,
            {
              name: "mappingId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Deleted" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/snapshots": {
        get: {
          summary: "List snapshots for a Cube",
          tags: ["Snapshots"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          responses: { "200": { description: "Snapshot list" } },
        },
        post: {
          summary: "Create a snapshot",
          tags: ["Snapshots"],
          parameters: [SPACE_PARAM, CUBE_PARAM, IDEMPOTENCY_HEADER],
          requestBody: {
            required: false,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "201": { description: "Snapshot enqueued" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/snapshots/{snapshotId}": {
        delete: {
          summary: "Delete a snapshot",
          tags: ["Snapshots"],
          parameters: [
            SPACE_PARAM,
            CUBE_PARAM,
            {
              name: "snapshotId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Deleted" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/{cubeId}/restore": {
        post: {
          summary: "Restore a Cube from a snapshot",
          tags: ["Snapshots"],
          parameters: [SPACE_PARAM, CUBE_PARAM],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["snapshotId"],
                  properties: { snapshotId: { type: "string" } },
                },
              },
            },
          },
          responses: {
            "200": { description: "Restore enqueued" },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
      },
      "/spaces/{spaceId}/backups/{backupId}/download": {
        get: {
          summary:
            "Generate a presigned download URL for a backup .cube archive",
          tags: ["Backups"],
          parameters: [
            SPACE_PARAM,
            {
              name: "backupId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Presigned URL valid for 15 minutes",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      url: { type: "string" },
                      filename: { type: "string" },
                      sizeBytes: { type: "integer", nullable: true },
                      expiresAt: {
                        type: "string",
                        format: "date-time",
                      },
                    },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": {
              description: "Backup is not in 'complete' status",
            },
          },
        },
      },
      "/spaces/{spaceId}/cubes/imports": {
        post: {
          summary:
            "Initiate a .cube archive import (browser-side multipart upload)",
          tags: ["Imports"],
          parameters: [SPACE_PARAM],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name", "fileSizeBytes"],
                  properties: {
                    name: { type: "string", maxLength: 64 },
                    fileSizeBytes: { type: "integer", minimum: 1_048_576 },
                    sshKeyMode: {
                      type: "string",
                      enum: ["replace", "keep"],
                      default: "replace",
                    },
                    sshPublicKey: { type: "string", nullable: true },
                    region: { type: "string", nullable: true },
                    vcpusOverride: { type: "integer", nullable: true },
                    ramMbOverride: { type: "integer", nullable: true },
                    diskGbOverride: { type: "integer", nullable: true },
                    userData: { type: "string", nullable: true },
                    expectedConfig: {
                      type: "object",
                      nullable: true,
                      properties: {
                        vcpus: { type: "integer" },
                        ramMb: { type: "integer" },
                        diskLimitGb: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Import initiated; returns presigned part URLs",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      importId: { type: "string" },
                      uploadId: { type: "string" },
                      key: { type: "string" },
                      chunkSizeBytes: { type: "integer" },
                      parts: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            partNumber: { type: "integer" },
                            url: { type: "string" },
                          },
                        },
                      },
                      expiresAt: { type: "string", format: "date-time" },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid input" },
            "403": { description: "Plan limit exceeded" },
            "503": { description: "No active storage backend" },
          },
        },
      },
      "/spaces/{spaceId}/cubes/imports/{importId}": {
        get: {
          summary: "Get the current state of an import",
          tags: ["Imports"],
          parameters: [
            SPACE_PARAM,
            {
              name: "importId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Current import state",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      import: {
                        type: "object",
                        properties: {
                          id: { type: "string" },
                          name: { type: "string" },
                          status: {
                            type: "string",
                            enum: [
                              "uploading",
                              "finalizing",
                              "provisioning",
                              "complete",
                              "failed",
                              "expired",
                            ],
                          },
                          cubeId: { type: "string", nullable: true },
                          error: { type: "string", nullable: true },
                          createdAt: { type: "string" },
                          updatedAt: { type: "string" },
                          completedAt: { type: "string", nullable: true },
                        },
                      },
                    },
                  },
                },
              },
            },
            "404": { $ref: "#/components/responses/NotFound" },
          },
        },
        delete: {
          summary:
            "Cancel an in-flight upload (only allowed in 'uploading' state)",
          tags: ["Imports"],
          parameters: [
            SPACE_PARAM,
            {
              name: "importId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Cancelled" },
            "404": { $ref: "#/components/responses/NotFound" },
            "409": {
              description: "Cannot cancel an import past the 'uploading' state",
            },
          },
        },
      },
      "/spaces/{spaceId}/cubes/imports/{importId}/complete": {
        post: {
          summary:
            "Finalize a .cube import: complete multipart upload + create cube row + enqueue provisioning",
          tags: ["Imports"],
          parameters: [
            SPACE_PARAM,
            {
              name: "importId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["parts", "config"],
                  properties: {
                    parts: {
                      type: "array",
                      items: {
                        type: "object",
                        required: ["partNumber", "etag"],
                        properties: {
                          partNumber: { type: "integer" },
                          etag: { type: "string" },
                        },
                      },
                    },
                    config: {
                      type: "object",
                      required: ["vcpus", "ramMb", "diskLimitGb", "imageId"],
                      properties: {
                        vcpus: { type: "integer" },
                        ramMb: { type: "integer" },
                        diskLimitGb: { type: "integer" },
                        imageId: { type: "string" },
                        userData: { type: "string", nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Provisioning enqueued",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      importId: { type: "string" },
                      cubeId: { type: "string" },
                      status: { type: "string", enum: ["provisioning"] },
                    },
                  },
                },
              },
            },
            "400": { description: "Invalid input" },
            "403": { description: "Plan limit exceeded" },
            "409": { description: "Import not in 'uploading' state" },
            "502": { description: "S3 finalization failed" },
            "503": { description: "Storage backend unavailable" },
          },
        },
      },
      "/spaces/{spaceId}/webhooks": {
        get: {
          summary: "List webhook endpoints",
          tags: ["Webhooks"],
          parameters: [SPACE_PARAM],
          responses: { "200": { description: "Webhook list" } },
        },
        post: {
          summary: "Create a webhook endpoint (signing secret returned once)",
          tags: ["Webhooks"],
          parameters: [SPACE_PARAM],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["url", "events"],
                  properties: {
                    url: { type: "string", format: "uri" },
                    events: {
                      type: "array",
                      items: {
                        type: "string",
                        enum: [
                          "cube.running",
                          "cube.sleeping",
                          "cube.error",
                          "cube.deleted",
                        ],
                      },
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "Webhook created (response includes secret)",
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/webhooks/{endpointId}": {
        get: {
          summary: "Get a webhook (no secret)",
          tags: ["Webhooks"],
          parameters: [
            SPACE_PARAM,
            {
              name: "endpointId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { "200": { description: "Webhook" } },
        },
        delete: {
          summary: "Delete a webhook (cascades deliveries)",
          tags: ["Webhooks"],
          parameters: [
            SPACE_PARAM,
            {
              name: "endpointId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Deleted" },
            "429": { $ref: "#/components/responses/RateLimited" },
          },
        },
      },
      "/spaces/{spaceId}/webhooks/{endpointId}/deliveries": {
        get: {
          summary: "Last 30 days of webhook delivery history (max 100)",
          tags: ["Webhooks"],
          parameters: [
            SPACE_PARAM,
            {
              name: "endpointId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: {
                type: "integer",
                minimum: 1,
                maximum: 100,
                default: 50,
              },
            },
          ],
          responses: { "200": { description: "Delivery list" } },
        },
      },
    },
    tags: [
      { name: "Public", description: "No authentication required" },
      { name: "Cubes", description: "Create, list, manage Cubes" },
      { name: "Domains" },
      { name: "TCP mappings" },
      { name: "Snapshots" },
      {
        name: "Backups",
        description:
          "Portable .cube archives — download an existing backup as a single file",
      },
      {
        name: "Imports",
        description:
          "Customer-uploaded .cube archives — browser-direct multipart upload to S3, then provisioning",
      },
      {
        name: "Webhooks",
        description: "Outbound HTTP callbacks for Cube events",
      },
    ],
  } as const;
}

export function GET() {
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
  return Response.json(buildSpec(baseUrl), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
