import {
  AiMessage,
  AskRequest,
  ApiError as ApiErrorSchema,
  AuthSession as AuthSessionSchema,
  AuthUser as AuthUserSchema,
  CreateGroupRequest,
  CreateInviteRequest,
  CreateLinkRoomRequest,
  CreateRoomResponse as CreateRoomResponseSchema,
  CreateTextRoomRequest,
  DashboardQuery,
  DashboardResponse as DashboardResponseSchema,
  FollowStateResponse as FollowStateResponseSchema,
  GroupsResponse as GroupsResponseSchema,
  InvitesResponse as InvitesResponseSchema,
  LoginRequest,
  MessageResponse as MessageResponseSchema,
  ParticipantsResponse as ParticipantsResponseSchema,
  Profile as ProfileSchema,
  RecapData as RecapDataSchema,
  RecapRequest,
  RefreshRequest,
  ResendVerificationRequest,
  RoomDetail as RoomDetailSchema,
  RoomGroup as RoomGroupSchema,
  RoomInvite as RoomInviteSchema,
  RoomStatusResponse as RoomStatusResponseSchema,
  TopMembersResponse as TopMembersResponseSchema,
  SignupRequest,
  UpdateGroupRequest,
  UpdateProfileRequest,
  UpdateRoomRequest,
  UsersQuery,
  UsersResponse as UsersResponseSchema,
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
const DashboardResponse = DashboardResponseSchema.meta({ id: "DashboardResponse" });
const FollowStateResponse = FollowStateResponseSchema.meta({ id: "FollowStateResponse" });
const GroupsResponse = GroupsResponseSchema.meta({ id: "GroupsResponse" });
const InvitesResponse = InvitesResponseSchema.meta({ id: "InvitesResponse" });
const MessageResponse = MessageResponseSchema.meta({ id: "MessageResponse" });
const ParticipantsResponse = ParticipantsResponseSchema.meta({ id: "ParticipantsResponse" });
const Profile = ProfileSchema.meta({ id: "Profile" });
const RoomDetail = RoomDetailSchema.meta({ id: "RoomDetail" });
const RoomGroup = RoomGroupSchema.meta({ id: "RoomGroup" });
const RoomInvite = RoomInviteSchema.meta({ id: "RoomInvite" });
const TopMembersResponse = TopMembersResponseSchema.meta({ id: "TopMembersResponse" });
const RoomStatusResponse = RoomStatusResponseSchema.meta({ id: "RoomStatusResponse" });
const UsersResponse = UsersResponseSchema.meta({ id: "UsersResponse" });
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
const roomId = z.object({ id: z.string() });

const PdfUpload = z.object({
  file: z.string().meta({ override: { type: "string", format: "binary" }, description: "PDF, up to 20 MB" }),
});

const FileUpload = z.object({
  file: z.string().meta({
    override: { type: "string", format: "binary" },
    description: "PDF, DOCX, PPTX, Markdown (.md) or text (.txt), up to 20 MB",
  }),
});

export const openApiDocument = createDocument({
  openapi: "3.1.0",
  info: {
    title: "LinkRoom API",
    version: "0.1.0",
    description: "Backend API. Use the access token from `POST /api/auth/login` to authorize.",
  },
  tags: [{ name: "Health" }, { name: "Auth" }, { name: "Me" }, { name: "Rooms" }, { name: "Groups" }, { name: "Users" }],
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
    "/api/me/rooms": {
      get: {
        tags: ["Me"],
        summary: "List the rooms on the user's dashboard",
        description:
          "Rooms the user created or joined, with filters, people and counts. Deleted rooms are left " +
          "out unless `status=deleted` is passed, and only ever appear for their owner.",
        security: bearer,
        requestParams: { query: DashboardQuery },
        responses: { "200": reply("One page of rooms", DashboardResponse), ...invalidInput, ...needsVerifiedUser },
      },
    },
    "/api/me/profile": {
      get: {
        tags: ["Me"],
        summary: "Get the user's profile",
        security: bearer,
        responses: { "200": reply("The profile", Profile), ...needsVerifiedUser },
      },
      patch: {
        tags: ["Me"],
        summary: "Update the user's profile",
        security: bearer,
        requestBody: body(UpdateProfileRequest),
        responses: { "200": reply("The updated profile", Profile), ...invalidInput, ...needsVerifiedUser },
      },
    },
    "/api/me/participants": {
      get: {
        tags: ["Me"],
        summary: "List people who share a room with the user",
        description: "Most recently seen first. `live` comes from the participant heartbeat.",
        security: bearer,
        responses: { "200": reply("People in the user's rooms", ParticipantsResponse), ...needsVerifiedUser },
      },
    },
    "/api/me/following": {
      get: {
        tags: ["Me"],
        summary: "List the people the user follows",
        security: bearer,
        responses: { "200": reply("Followed people", UsersResponse), ...needsVerifiedUser },
      },
    },
    "/api/me/followers": {
      get: {
        tags: ["Me"],
        summary: "List the people who follow the user",
        security: bearer,
        responses: { "200": reply("Followers", UsersResponse), ...needsVerifiedUser },
      },
    },
    "/api/me/invites": {
      get: {
        tags: ["Me"],
        summary: "List invites received and sent",
        security: bearer,
        responses: { "200": reply("Invites in both directions", InvitesResponse), ...needsVerifiedUser },
      },
    },
    "/api/groups": {
      get: {
        tags: ["Groups"],
        summary: "List the user's room groups",
        security: bearer,
        responses: { "200": reply("The user's groups", GroupsResponse), ...needsVerifiedUser },
      },
      post: {
        tags: ["Groups"],
        summary: "Create a group",
        security: bearer,
        requestBody: body(CreateGroupRequest),
        responses: {
          "201": reply("Group created", RoomGroup),
          ...invalidInput,
          ...needsVerifiedUser,
          "409": failure("A group with that name already exists"),
        },
      },
    },
    "/api/groups/{id}": {
      patch: {
        tags: ["Groups"],
        summary: "Rename, recolour or reorder a group",
        security: bearer,
        requestParams: { path: roomId },
        requestBody: body(UpdateGroupRequest),
        responses: {
          "200": reply("The updated group", RoomGroup),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("Group not found, or owned by someone else"),
          "409": failure("A group with that name already exists"),
        },
      },
      delete: {
        tags: ["Groups"],
        summary: "Delete a group",
        description: "The rooms in it survive, unfiled.",
        security: bearer,
        requestParams: { path: roomId },
        responses: {
          "204": { description: "Group deleted" },
          ...needsVerifiedUser,
          "404": failure("Group not found, or owned by someone else"),
        },
      },
    },
    "/api/users/search": {
      get: {
        tags: ["Users"],
        summary: "Search people by display name",
        security: bearer,
        requestParams: { query: UsersQuery },
        responses: { "200": reply("Matching people", UsersResponse), ...invalidInput, ...needsVerifiedUser },
      },
    },
    "/api/users/{id}/follow": {
      post: {
        tags: ["Users"],
        summary: "Follow a user",
        security: bearer,
        requestParams: { path: roomId },
        responses: {
          "200": reply("Now following", FollowStateResponse),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("User not found"),
        },
      },
      delete: {
        tags: ["Users"],
        summary: "Stop following a user",
        security: bearer,
        requestParams: { path: roomId },
        responses: { "200": reply("No longer following", FollowStateResponse), ...invalidInput, ...needsVerifiedUser },
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
          "422": failure(
            "The page could not be read: unknown host, error status, not HTML, too large or no article text. " +
              "Sites known not to work from a link (Notion, Google Docs, ...) get advice on what to upload instead.",
          ),
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
    "/api/rooms/file": {
      post: {
        tags: ["Rooms"],
        summary: "Create a room from an uploaded document",
        description:
          "The format comes from the bytes, not the Content-Type: `%PDF-` is a PDF room (as `POST /api/rooms/pdf`); " +
          "a ZIP with `word/document.xml` or `ppt/presentation.xml` is DOCX or PPTX; `.md` and `.txt` must be valid UTF-8. " +
          "ZIPs are refused if they unpack to more than 50 MB or hold more than 2,000 files. DOCX images are dropped. " +
          "Non-PDF files become `kind: \"file\"` rooms with block HTML (one `p{n}` block per slide for PPTX), and " +
          "`source_meta` records the format and file name.",
        security: bearer,
        requestBody: { required: true, content: { "multipart/form-data": { schema: FileUpload } } },
        responses: {
          ...roomCreated,
          "400": failure(
            "No file, more than one file, an unsupported or old (.doc/.ppt) format, invalid UTF-8 or a ZIP that is too large",
          ),
          ...needsVerifiedUser,
          "413": failure("The file is over 20 MB"),
          "422": failure("The file is damaged, has no text or has too much text for one room"),
        },
      },
    },
    "/api/rooms/{id}": {
      patch: {
        tags: ["Rooms"],
        summary: "Pause, resume, close, archive or move a room",
        description: "Owner only. Deleting has its own endpoints so the room's PDF is never left public by accident.",
        security: bearer,
        requestParams: { path: roomId },
        requestBody: body(UpdateRoomRequest),
        responses: {
          "200": reply("The updated room", RoomDetail),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("Room or group not found, or owned by someone else"),
          "409": failure("The room is deleted, or was deleted during this request; restore it first"),
        },
      },
      delete: {
        tags: ["Rooms"],
        summary: "Soft-delete a room",
        description: "The room disappears for everyone but its owner, who can restore it.",
        security: bearer,
        requestParams: { path: roomId },
        responses: {
          "200": reply("The deleted room", RoomDetail),
          ...needsVerifiedUser,
          "404": failure("Room not found, or owned by someone else"),
          "409": failure("Another status change got there first"),
        },
      },
    },
    "/api/rooms/{id}/restore": {
      post: {
        tags: ["Rooms"],
        summary: "Restore a soft-deleted room",
        security: bearer,
        requestParams: { path: roomId },
        responses: {
          "200": reply("The restored room", RoomDetail),
          ...needsVerifiedUser,
          "404": failure("Room not found, or owned by someone else"),
          "409": failure("The room is not deleted, or another change got there first"),
        },
      },
    },
    "/api/rooms/{id}/join": {
      post: {
        tags: ["Rooms"],
        summary: "Join a room, remember it on the dashboard and send a heartbeat",
        description:
          "Closed, paused and archived rooms can be joined to read them. Call it periodically while reading " +
          "to drive the dashboard's live counts. Guests skip this and open the link.",
        security: bearer,
        requestParams: { path: roomId },
        responses: {
          "200": reply("The room", RoomStatusResponse),
          ...needsVerifiedUser,
          "404": failure("Room not found or deleted"),
        },
      },
    },
    "/api/rooms/{id}/invites": {
      post: {
        tags: ["Rooms"],
        summary: "Invite a user to a room",
        security: bearer,
        requestParams: { path: roomId },
        requestBody: body(CreateInviteRequest),
        responses: {
          "201": reply("Invite sent", RoomInvite),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("Room or user not found"),
          "409": failure("They are already in the room, or already have a pending invite"),
        },
      },
    },
    "/api/rooms/{id}/top-members": {
      get: {
        tags: ["Rooms"],
        summary: "The three most active people in a room",
        description:
          "Ranked by highlights plus comments, most recently active first on a tie. People are told apart " +
          "by the name they typed, so guests are included and names aren't linked to accounts.",
        security: bearer,
        requestParams: { path: roomId },
        responses: {
          "200": reply("Up to three people, most active first", TopMembersResponse),
          ...needsVerifiedUser,
          "404": failure("Room not found or deleted"),
        },
      },
    },
    "/api/rooms/{id}/ask": {
      post: {
        tags: ["Rooms"],
        summary: "Ask the AI a question about a room's document",
        description:
          "Finds the best chunks of the room (by embedding and keyword, keyword only when embeddings are " +
          "unavailable) and answers from them alone. Every citation is checked against its chunk; pages and " +
          "times come from the chunk. When the document doesn't answer, `found_in_document` is false and the " +
          "answer says so. The saved message reaches everyone in the room through Supabase Realtime. Guests " +
          "can ask; `name` (or a signed-in caller's name) is saved as `asked_by`. At most 10 questions a " +
          "minute per IP and 30 per room.",
        requestParams: { path: roomId },
        requestBody: body(AskRequest),
        responses: {
          "201": reply("The answer, as saved", AiMessage),
          ...invalidInput,
          "404": failure("Room not found or deleted"),
          "409": failure("The room is archived, or the AI is still reading it or couldn't read it"),
          "422": failure("Moderation refused the question; it is not saved or shown to the room"),
          "429": failure("Too many questions from this IP or in this room in the last minute"),
          "502": failure("The AI service failed, timed out or returned an unexpected shape"),
          "503": failure("No AI provider is configured"),
        },
      },
    },
    "/api/rooms/{id}/recap": {
      post: {
        tags: ["Rooms"],
        summary: "Generate an AI recap of a room",
        description:
          "The stored recap reaches every client through Supabase Realtime. Guests can ask for one; " +
          "with a bearer token the caller is recorded in the recap history. `name` is saved as " +
          "`requested_by` (\"Recapped by …\"); without it, a signed-in caller's name is used.",
        requestParams: { path: roomId },
        requestBody: { required: false, ...json(RecapRequest) },
        responses: {
          "200": reply("The recap", RecapData),
          ...invalidInput,
          "404": failure("Room not found or deleted"),
          "409": failure("The room is archived, or a recap for it is already being made"),
          "422": failure("Nothing is highlighted yet, so there is nothing to recap"),
          "429": {
            ...failure("A recap was made in the last 30 s"),
            headers: {
              "Retry-After": { description: "Seconds until the next recap is allowed", schema: { type: "integer" } },
            },
          },
          "502": failure("The AI service failed, timed out or returned an unexpected shape"),
          "503": failure("No AI provider is configured"),
        },
      },
    },
  },
});
