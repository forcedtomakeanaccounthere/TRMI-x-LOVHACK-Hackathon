import {
  ApiError as ApiErrorSchema,
  AuthSession as AuthSessionSchema,
  AuthUser as AuthUserSchema,
  CreateLinkRoomRequest,
  CreateRoomResponse as CreateRoomResponseSchema,
  CreateTextRoomRequest,
  LoginRequest,
  MessageResponse as MessageResponseSchema,
  RecapData as RecapDataSchema,
  RefreshRequest,
  ResendVerificationRequest,
  SignupRequest,
} from "@linkroom/shared";
import { z } from "zod";
import { createDocument } from "zod-openapi";
import { VerifyQuery } from "./routes/auth";

// The API description served at /openapi.json and /docs, built from the same zod schemas
// the routes validate with. test/unit/openapi.test.ts fails if a route is missing here.

const ApiError = ApiErrorSchema.meta({ id: "ApiError" });
const AuthSession = AuthSessionSchema.meta({ id: "AuthSession" });
const AuthUser = AuthUserSchema.meta({ id: "AuthUser" });
const CreateRoomResponse = CreateRoomResponseSchema.meta({ id: "CreateRoomResponse" });
const MessageResponse = MessageResponseSchema.meta({ id: "MessageResponse" });
const RecapData = RecapDataSchema.meta({ id: "RecapData" });

const json = (schema: z.ZodType) => ({ content: { "application/json": { schema } } });
const body = (schema: z.ZodType) => ({ required: true, ...json(schema) });
const reply = (description: string, schema: z.ZodType) => ({ description, ...json(schema) });
const failure = (description: string) => reply(description, ApiError);

const bearer = [{ bearerAuth: [] }];
const needsVerifiedUser = {
  "401": failure("Missing, invalid or revoked access token"),
  "403": failure("Email not verified"),
};
const invalidInput = { "400": failure("Invalid input") };
const tooManyAttempts = { "429": failure("Too many attempts") };
const roomCreated = { "201": reply("Room created", CreateRoomResponse) };

const PdfUpload = z.object({
  file: z.string().meta({ override: { type: "string", format: "binary" }, description: "PDF, up to 20 MB" }),
});

export const openApiDocument = createDocument({
  openapi: "3.1.0",
  info: {
    title: "LinkRoom API",
    version: "0.1.0",
    description: "Backend API. Use the access token from `POST /api/auth/login` to authorize.",
  },
  tags: [{ name: "Health" }, { name: "Auth" }, { name: "Rooms" }],
  components: {
    securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Check that the service is up",
        responses: {
          "200": reply("Service is up", z.object({ ok: z.boolean(), service: z.string() })),
        },
      },
    },
    "/api/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Create an account and send a verification email",
        description: "Replies the same for an email that is already registered.",
        requestBody: body(SignupRequest),
        responses: {
          "201": reply("Verification email sent", MessageResponse),
          ...invalidInput,
          "403": failure("Sign up is disabled"),
          ...tooManyAttempts,
        },
      },
    },
    "/api/auth/verify": {
      get: {
        tags: ["Auth"],
        summary: "Verify an email address",
        description:
          "Target of the link in the verification email. Redirects to the frontend's `/login` with `verified=1`, or `verified=0` and an `error`.",
        requestParams: { query: VerifyQuery },
        responses: { "302": { description: "Redirect to the frontend" } },
      },
    },
    "/api/auth/resend-verification": {
      post: {
        tags: ["Auth"],
        summary: "Send the verification email again",
        requestBody: body(ResendVerificationRequest),
        responses: {
          "200": reply("Sent, if the account needs verifying", MessageResponse),
          ...invalidInput,
          ...tooManyAttempts,
        },
      },
    },
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Log in",
        requestBody: body(LoginRequest),
        responses: {
          "200": reply("Logged in", AuthSession),
          ...invalidInput,
          "401": failure("Invalid email or password"),
          "403": failure("Email not verified"),
          ...tooManyAttempts,
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Exchange a refresh token for a new session",
        requestBody: body(RefreshRequest),
        responses: {
          "200": reply("New session", AuthSession),
          ...invalidInput,
          "401": failure("Session expired: the refresh token was rejected, so sign in again"),
          "503": failure("Auth is temporarily unavailable: keep the refresh token and retry"),
        },
      },
    },
    "/api/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Log out and revoke the session",
        security: bearer,
        responses: {
          "204": { description: "Logged out" },
          ...needsVerifiedUser,
          "502": failure("Could not log out; retry"),
        },
      },
    },
    "/api/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get the logged-in user",
        security: bearer,
        responses: { "200": reply("The logged-in user", AuthUser), ...needsVerifiedUser },
      },
    },
    "/api/rooms/link": {
      post: {
        tags: ["Rooms"],
        summary: "Create a room from a web page",
        description:
          "Fetches the page (10 s timeout, 5 MB limit, up to 5 redirects), extracts the article and sanitizes it. " +
          "Hosts that are or resolve to a private address are refused, on every redirect hop.",
        security: bearer,
        requestBody: body(CreateLinkRoomRequest),
        responses: {
          ...roomCreated,
          "400": failure("Invalid URL: not http(s), or a private or local address"),
          ...needsVerifiedUser,
          "422": failure("The page could not be read: unknown host, error status, not HTML, too large or no article text"),
        },
      },
    },
    "/api/rooms/text": {
      post: {
        tags: ["Rooms"],
        summary: "Create a room from pasted text",
        description: "Fallback for sites that can't be read.",
        security: bearer,
        requestBody: body(CreateTextRoomRequest),
        responses: { ...roomCreated, ...invalidInput, ...needsVerifiedUser },
      },
    },
    "/api/rooms/pdf": {
      post: {
        tags: ["Rooms"],
        summary: "Create a room from a PDF",
        description:
          "The file must start with `%PDF-`, whatever its Content-Type. The text of the first 50 pages " +
          "(up to 60,000 characters) is kept for the AI recap.",
        security: bearer,
        requestBody: { required: true, content: { "multipart/form-data": { schema: PdfUpload } } },
        responses: {
          ...roomCreated,
          "400": failure('No file, more than one file, or the upload is not a PDF'),
          ...needsVerifiedUser,
          "413": failure("The PDF is over 20 MB"),
          "422": failure("The PDF is damaged or password-protected"),
        },
      },
    },
    "/api/rooms/{id}/recap": {
      post: {
        tags: ["Rooms"],
        summary: "Generate an AI recap of a room",
        description: "The stored recap reaches every client through Supabase Realtime.",
        requestParams: { path: z.object({ id: z.string() }) },
        responses: {
          "200": reply("The recap", RecapData),
          "404": failure("Room not found"),
          "502": failure("The AI service failed"),
        },
      },
    },
  },
});
