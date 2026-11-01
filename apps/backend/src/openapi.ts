import {
  AiMessage,
  AskRequest,
  ApiError as ApiErrorSchema,
  AuthSession as AuthSessionSchema,
  AuthUser as AuthUserSchema,
  CreateGroupRequest,
  CreateInviteRequest,
  CreateLinkRoomRequest,
  CreateStudyRequest,
  CreateRoomResponse as CreateRoomResponseSchema,
  CreateTextRoomRequest,
  CreateYoutubeRoomRequest,
  CreateDrawingRequest,
  RemoveDrawingRequest,
  Drawing as DrawingSchema,
  ExportSummaryQuery,
  OriginalFileResponse,
  ListEventsQuery,
  ListEventsResponse,
  PostEventsRequest,
  PostEventsResponse,
  RoomMembersResponse,
  AddSourceRequest,
  AttachedSource,
  RoomSourcesResponse,
  CreateHuddleRequest,
  InviteHuddleRequest,
  JoinHuddleRequest,
  ListHuddlesResponse,
  HuddleJoinResponse,
  PostSegmentsRequest,
  HuddleFocusRequest,
  HuddleTranscriptQuery,
  HuddleTranscriptResponse,
  ArtifactRequest,
  NotebookResponse,
  NotebookUpdateRequest,
  ArtifactBody,
  CatchupRequest,
  CatchupResponse,
  ExplainRequest,
  QuizResponse,
  DashboardQuery,
  DashboardResponse as DashboardResponseSchema,
  FollowStateResponse as FollowStateResponseSchema,
  GroupsResponse as GroupsResponseSchema,
  InvitesResponse as InvitesResponseSchema,
  ForgotPasswordRequest,
  LoginRequest,
  MessageResponse as MessageResponseSchema,
  MentionAck as MentionAckSchema,
  MentionNotifyRequest,
  MarkReadRequest,
  MentionablesResponse as MentionablesResponseSchema,
  NotificationsResponse as NotificationsResponseSchema,
  PushSubscribeRequest,
  PushKeyResponse as PushKeyResponseSchema,
  ParticipantsResponse as ParticipantsResponseSchema,
  Profile as ProfileSchema,
  RecapData as RecapDataSchema,
  RecapRequest,
  RefreshRequest,
  ResendVerificationRequest,
  ResetPasswordRequest,
  RoomDetail as RoomDetailSchema,
  RoomGroup as RoomGroupSchema,
  RoomInvite as RoomInviteSchema,
  RoomStatusResponse as RoomStatusResponseSchema,
  TopMembersResponse as TopMembersResponseSchema,
  SignupRequest,
  StudySet as StudySetSchema,
  StudySetsResponse as StudySetsResponseSchema,
  StudySourcesQuery,
  StudySourcesResponse as StudySourcesResponseSchema,
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
const NotificationsResponse = NotificationsResponseSchema.meta({ id: "NotificationsResponse" });
const PushKeyResponse = PushKeyResponseSchema.meta({ id: "PushKeyResponse" });
const MentionAck = MentionAckSchema.meta({ id: "MentionAck" });
const MentionablesResponse = MentionablesResponseSchema.meta({ id: "MentionablesResponse" });
const UnsubscribeRequest = z.object({ endpoint: z.string().url().max(2048) });
const ParticipantsResponse = ParticipantsResponseSchema.meta({ id: "ParticipantsResponse" });
const Profile = ProfileSchema.meta({ id: "Profile" });
const RoomDetail = RoomDetailSchema.meta({ id: "RoomDetail" });
const RoomGroup = RoomGroupSchema.meta({ id: "RoomGroup" });
const RoomInvite = RoomInviteSchema.meta({ id: "RoomInvite" });
const TopMembersResponse = TopMembersResponseSchema.meta({ id: "TopMembersResponse" });
const Drawing = DrawingSchema.meta({ id: "Drawing" });
const RoomStatusResponse = RoomStatusResponseSchema.meta({ id: "RoomStatusResponse" });
const UsersResponse = UsersResponseSchema.meta({ id: "UsersResponse" });
const RecapData = RecapDataSchema.meta({ id: "RecapData" });
const StudySet = StudySetSchema.meta({ id: "StudySet" });
const StudySetsResponse = StudySetsResponseSchema.meta({ id: "StudySetsResponse" });
const StudySourcesResponse = StudySourcesResponseSchema.meta({ id: "StudySourcesResponse" });
const studySetId = z.object({ id: z.string().uuid() });

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
  tags: [{ name: "Health" }, { name: "Auth" }, { name: "Me" }, { name: "Rooms" }, { name: "Notifications" }, { name: "Groups" }, { name: "Users" }],
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
          ...tooManyAttempts,
          "502": failure("The verification email could not be sent"),
        },
      },
    },
    "/api/auth/verify": {
      get: {
        tags: ["Auth"],
        summary: "Verify an email address",
        description:
          "Target of the link in the verification email. Redirects to the frontend's `/login` with `verified=1` and the `email`, or `verified=0` and an `error`.",
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
          "502": failure("The verification email could not be sent"),
        },
      },
    },
    "/api/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Email a password reset link (to /forgot-password) to a verified account",
        requestBody: body(ForgotPasswordRequest),
        responses: {
          "200": reply("Sent, if the email has a verified account (the same reply either way)", MessageResponse),
          ...invalidInput,
          ...tooManyAttempts,
          "502": failure("The reset email could not be sent"),
        },
      },
    },
    "/api/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Set a new password with the reset link's token, and sign the account out everywhere",
        requestBody: body(ResetPasswordRequest),
        responses: {
          "200": reply("Password changed", MessageResponse),
          "400": failure("Invalid input, an expired or used link (the message says \"expired\"), or a weak or reused password"),
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
    "/api/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "My notification inbox (mentions)",
        security: bearer,
        responses: {
          "200": reply("Up to 50 newest, unread counted", NotificationsResponse),
          ...needsVerifiedUser,
        },
      },
    },
    "/api/notifications/read": {
      post: {
        tags: ["Notifications"],
        summary: "Mark notifications read",
        description: "With no ids, everything unread is marked read.",
        security: bearer,
        requestBody: { required: false, ...json(MarkReadRequest.optional()) },
        responses: { "200": reply("Marked", MessageResponse), ...invalidInput, ...needsVerifiedUser },
      },
    },
    "/api/notifications/key": {
      get: {
        tags: ["Notifications"],
        summary: "The VAPID public key for Web Push",
        description: "Null until the server has the VAPID key pair configured.",
        security: bearer,
        responses: { "200": reply("Public key, or null when push is off", PushKeyResponse), ...needsVerifiedUser },
      },
    },
    "/api/notifications/subscribe": {
      post: {
        tags: ["Notifications"],
        summary: "Subscribe this browser to Web Push",
        security: bearer,
        requestBody: body(PushSubscribeRequest),
        responses: {
          "200": reply("Subscription stored", MessageResponse),
          ...invalidInput,
          ...needsVerifiedUser,
        },
      },
    },
    "/api/notifications/unsubscribe": {
      post: {
        tags: ["Notifications"],
        summary: "Unsubscribe this browser from Web Push",
        security: bearer,
        requestBody: body(UnsubscribeRequest),
        responses: {
          "200": reply("Removed", MessageResponse),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("Not subscribed"),
        },
      },
    },
    "/api/notifications/rooms/{roomId}/people": {
      get: {
        tags: ["Notifications"],
        summary: "People who can be @mentioned in a room",
        description: "The owner and every signed-in reader who has opened the room and was not removed, present or not.",
        requestParams: { path: z.object({ roomId: z.string() }) },
        responses: { "200": reply("People by name", MentionablesResponse), "404": failure("Room not found") },
      },
    },
    "/api/notifications/rooms/{roomId}/mentions": {
      post: {
        tags: ["Notifications"],
        summary: "Announce @mentions of a message just written",
        description:
          "The browser calls this after writing a chat message or note that tags people. Every " +
          "mentioned room member gets a notification in their bell; members online in the room " +
          "(a heartbeat in the last two minutes) get a toast there, everyone else an email and a " +
          "Web Push where they subscribed. Each event notifies a person once. Guests can announce; " +
          "a signed-in caller must be the author.",
        requestParams: { path: z.object({ roomId: z.string() }) },
        requestBody: body(MentionNotifyRequest),
        responses: {
          "200": reply("How many people were notified", MentionAck),
          ...invalidInput,
          ...tooManyAttempts,
          "401": failure("Guests must send a guest- author id"),
          "403": failure("Author must be the signed-in user"),
          "404": failure("Room not found"),
          "409": failure("Room is not running"),
        },
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
    "/api/rooms/youtube": {
      post: {
        tags: ["Rooms"],
        summary: "Create a room from a YouTube video's transcript",
        description:
          "The transcript is fetched from YouTube's captions (preferring English, then Hindi, then any " +
          "language), or taken from `transcript` when given: text copied from YouTube's \"Show " +
          "transcript\", with or without its timestamps. Paragraphs become t{n} blocks that keep their " +
          "time range in `data-start` / `data-end`, so answers and summaries can point into the video. " +
          "The detailed summary is written in the background.",
        security: bearer,
        requestBody: body(CreateYoutubeRoomRequest),
        responses: {
          ...roomCreated,
          "400": failure("Not a YouTube video link, or an invalid body"),
          ...needsVerifiedUser,
          "422": failure("No readable captions, YouTube blocked the fetch, or the transcript is empty: paste it instead"),
          "502": failure("Fetching the transcript failed or timed out"),
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
    "/api/rooms/{id}/activity": {
      post: {
        tags: ["Rooms"],
        summary: "Record keystrokes, mouse events, or interaction in a room",
        description:
          "Updates the room's last_activity_at timestamp to prevent auto-pausing. " +
          "When authenticated, also refreshes participant last_seen_at.",
        requestParams: { path: roomId },
        responses: {
          "200": reply("Activity recorded", RoomStatusResponse),
          "404": failure("Room not found or deleted"),
          "409": failure("Room is not running (e.g. paused, closed, archived)"),
        },
      },
    },
    "/api/rooms/{id}/heartbeat": {
      post: {
        tags: ["Rooms"],
        summary: "Record reader presence heartbeat",
        description:
          "Records presence for both signed-in readers and guests without resetting the idle activity timer.",
        requestParams: { path: roomId },
        responses: {
          "200": reply("Presence recorded", RoomStatusResponse),
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
    "/api/rooms/{id}/catchup": {
      post: {
        tags: ["AI"],
        summary: "Catch me up: what the group did since a time",
        description: "Only for the caller, so nothing is saved. With nothing new since `since`, the AI isn't called.",
        requestParams: { path: roomId },
        requestBody: body(CatchupRequest),
        responses: {
          "200": reply("The catch-up", CatchupResponse),
          ...invalidInput,
          "404": failure("Room not found or deleted"),
          "429": failure("Too many AI requests from this IP or in this room in the last minute"),
          "502": failure("The AI service failed"),
        },
      },
    },
    "/api/rooms/{id}/explain": {
      post: {
        tags: ["AI"],
        summary: "Explain a highlight, simply or in Hinglish",
        description: "Saved as an ai_messages row (kind explain) that the whole room sees. A moderated-out explanation is saved as withheld.",
        requestParams: { path: roomId },
        requestBody: body(ExplainRequest),
        responses: {
          "201": reply("The saved explanation", AiMessage),
          ...invalidInput,
          "404": failure("Room or highlight not found"),
          "409": failure("The room is archived"),
          "429": failure("Too many AI requests from this IP or in this room in the last minute"),
          "502": failure("The AI service failed"),
        },
      },
    },
    "/api/rooms/{id}/quiz": {
      post: {
        tags: ["AI"],
        summary: "A five-question quiz on the room",
        description: "Each question cites the blocks it comes from. Not saved: answers go over Realtime broadcast.",
        requestParams: { path: roomId },
        responses: {
          "200": reply("The quiz", QuizResponse),
          "404": failure("Room not found or deleted"),
          "409": failure("The room has no chunks yet"),
          "429": failure("Too many AI requests from this IP or in this room in the last minute"),
          "502": failure("The AI service failed"),
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
    "/api/rooms/{id}/summary/export": {
      get: {
        tags: ["Rooms"],
        summary: "Export room summary as Markdown or plain text",
        requestParams: { path: roomId, query: ExportSummaryQuery },
        responses: {
          "200": {
            description: "The summary file attachment",
            content: {
              "text/markdown": { schema: { type: "string" } },
              "text/plain": { schema: { type: "string" } },
            },
          },
          "404": failure("Summary not ready yet"),
        },
      },
    },
    "/api/rooms/{id}/original": {
      get: {
        tags: ["Rooms"],
        summary: "Get a short-lived download link for the file a room was made from",
        requestParams: { path: roomId },
        responses: {
          "200": reply("A signed link that downloads the original under its file name", OriginalFileResponse),
          "404": failure("Unknown or deleted room, a room with no file (link, text, video), or a missing file"),
        },
      },
    },
    "/api/rooms/{id}/events": {
      get: {
        tags: ["Room workspace"],
        summary: "List the room's ledger events in the order they were accepted (paged by seq)",
        requestParams: { path: roomId, query: ListEventsQuery, header: z.object({ "x-guest-id": z.string().optional(), "x-guest-key": z.string().optional() }) },
        responses: {
          "200": reply("The events, and the seq to pass as `after` for the next page", ListEventsResponse),
          "403": failure("You were removed, or the room is for signed-in members only"),
          "404": failure("Unknown or deleted room"),
        },
      },
      post: {
        tags: ["Room workspace"],
        summary: "Append ledger events; each is checked against the writer's role and kicks",
        description:
          "Signed-in callers write as their account. Guests send X-Guest-Id and X-Guest-Key: the first write claims the id, later ones must send the same key. Events already saved count as accepted (retries are safe).",
        requestParams: { path: roomId, header: z.object({ "x-guest-id": z.string().optional(), "x-guest-key": z.string().optional() }) },
        requestBody: { content: { "application/json": { schema: PostEventsRequest } } },
        responses: {
          "200": reply("Which events were saved, and why the others weren't", PostEventsResponse),
          "401": failure("Neither signed in nor a guest id and key"),
          "403": failure("Removed from the room, guests not allowed, or a guest id claimed with another key"),
          "404": failure("Unknown or deleted room"),
          "429": failure("Too many writes"),
        },
      },
    },
    "/api/rooms/{id}/members": {
      get: {
        tags: ["Room workspace"],
        summary: "The room's members (roles and removals) and settings",
        requestParams: { path: roomId, header: z.object({ "x-guest-id": z.string().optional(), "x-guest-key": z.string().optional() }) },
        responses: {
          "200": reply("Members and settings", RoomMembersResponse),
          "403": failure("You were removed, or the room is for signed-in members only"),
          "404": failure("Unknown or deleted room"),
        },
      },
    },
    "/api/rooms/{id}/sources": {
      get: {
        tags: ["Room workspace"],
        summary: "The documents attached to a room, in order",
        requestParams: { path: roomId },
        responses: {
          "200": reply("The attached rooms", RoomSourcesResponse),
          "403": failure("You were removed, or the room is for signed-in members only"),
          "404": failure("Unknown or deleted room"),
        },
      },
      post: {
        tags: ["Room workspace"],
        summary: "Attach another room as a source (editors and up)",
        requestParams: { path: roomId },
        requestBody: body(AddSourceRequest),
        responses: {
          "200": reply("It was already attached", AttachedSource),
          "201": reply("Attached", AttachedSource),
          "400": failure("A room attached to itself"),
          "401": failure("Not signed in"),
          "403": failure("Your role can't add sources, or you were removed"),
          "404": failure("Unknown room or document"),
          "409": failure("The room is read only, or already has the most sources it can"),
        },
      },
    },
    "/api/rooms/{id}/sources/{sourceId}": {
      delete: {
        tags: ["Room workspace"],
        summary: "Detach a source (whoever attached it, or an admin)",
        requestParams: { path: z.object({ id: z.string(), sourceId: z.string() }) },
        responses: {
          "200": reply("Detached", z.object({ ok: z.literal(true) })),
          "401": failure("Not signed in"),
          "403": failure("Not who attached it, nor an admin"),
          "404": failure("That source isn't attached"),
          "409": failure("The room is read only"),
        },
      },
    },
    "/api/rooms/{id}/artifacts": {
      post: {
        tags: ["Room workspace"],
        summary: "Make a Studio artifact (summary, quiz, flashcards, mind map or infographic) from the room's sources",
        requestParams: { path: roomId },
        requestBody: body(ArtifactRequest),
        responses: {
          "200": reply("The artifact's content", ArtifactBody),
          "403": failure("Your role can't make artifacts, or you were removed"),
          "404": failure("Unknown room, or a source that isn't in it"),
          "409": failure("Read-only room, summaries not ready, or one already being made"),
          "422": failure("The sources have no text"),
          "429": failure("Too many requests"),
          "502": failure("The AI couldn't answer"),
        },
      },
    },
    "/api/rooms/{id}/notebook": {
      get: {
        tags: ["Room workspace"],
        summary: "Get the room's shared notebook (a Yjs document as base64, or null before anyone wrote)",
        requestParams: { path: roomId },
        responses: {
          "200": reply("The notebook", NotebookResponse),
          "403": failure("You were removed, or the room is for members only"),
          "404": failure("Unknown room"),
        },
      },
      post: {
        tags: ["Room workspace"],
        summary: "Merge a batch of notebook edits (one Yjs update, base64) into the saved notebook",
        requestParams: { path: roomId },
        requestBody: body(NotebookUpdateRequest),
        responses: {
          "204": { description: "Merged" },
          "400": failure("Not base64, or not a Yjs update"),
          "403": failure("Your role can't write in the notebook, or you were removed"),
          "404": failure("Unknown room"),
          "409": failure("Read-only room, or too many writes at once"),
          "413": failure("The notebook is full"),
          "429": failure("Too many requests"),
        },
      },
    },
    "/api/rooms/{id}/drawings": {
      get: {
        tags: ["Rooms"],
        summary: "Get all drawings for a room",
        requestParams: { path: roomId, query: z.object({ page_num: z.coerce.number().optional() }) },
        responses: {
          "200": reply("The drawings", z.array(Drawing)),
        },
      },
      post: {
        tags: ["Rooms"],
        summary: "Save a new drawing stroke",
        requestParams: { path: roomId },
        requestBody: body(CreateDrawingRequest),
        responses: {
          "201": reply("The saved drawing", Drawing),
          ...invalidInput,
        },
      },
    },
    "/api/rooms/{id}/drawings/{drawingId}": {
      delete: {
        tags: ["Rooms"],
        summary: "Delete a drawing stroke",
        description:
          "Only with the remove key the stroke was saved with (its SHA-256 is the stroke's `remove_key_hash`).",
        requestParams: { path: z.object({ id: z.string(), drawingId: z.string() }) },
        requestBody: body(RemoveDrawingRequest),
        responses: {
          "200": reply("Success", z.object({ ok: z.boolean() })),
          ...invalidInput,
          "404": failure("Room or drawing not found, or the key does not match"),
        },
      },
    },
    "/api/rooms/{id}/huddles": {
      get: {
        tags: ["Voice huddles"],
        summary: "List open and recent huddles visible to the caller",
        requestParams: { path: roomId },
        responses: {
          "200": reply("Visible huddles", ListHuddlesResponse),
          "403": failure("You were removed, or the room is for members only"),
          "404": failure("Unknown room"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
      post: {
        tags: ["Voice huddles"],
        summary: "Create a room-wide or private voice huddle",
        requestParams: { path: roomId },
        requestBody: body(CreateHuddleRequest),
        responses: {
          "201": reply("Joined huddle", HuddleJoinResponse),
          "400": failure("Invalid audience or member list"),
          "401": failure("Authentication required"),
          "403": failure("Permission denied"),
          "404": failure("Unknown room"),
          "429": failure("Too many requests"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/join": {
      post: {
        tags: ["Voice huddles"],
        summary: "Join an open voice huddle and receive LiveKit credentials",
        requestParams: { path: z.object({ id: z.string(), hid: z.string() }) },
        requestBody: body(JoinHuddleRequest),
        responses: {
          "200": reply("Joined huddle", HuddleJoinResponse),
          "400": failure("Huddle has ended"),
          "401": failure("Authentication required"),
          "403": failure("Permission denied"),
          "404": failure("Unknown huddle"),
          "429": failure("Too many requests"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/leave": {
      post: {
        tags: ["Voice huddles"],
        summary: "Leave a voice huddle",
        requestParams: { path: z.object({ id: z.string(), hid: z.string() }) },
        responses: {
          "200": reply("Success", z.object({ ok: z.boolean() })),
          "401": failure("Authentication required"),
          "404": failure("Unknown huddle"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/invite": {
      post: {
        tags: ["Voice huddles"],
        summary: "Invite members to a private voice huddle",
        requestParams: { path: z.object({ id: z.string(), hid: z.string() }) },
        requestBody: body(InviteHuddleRequest),
        responses: {
          "200": reply("Success", z.object({ ok: z.boolean() })),
          "400": failure("Invalid members or not a private huddle"),
          "401": failure("Authentication required"),
          "403": failure("Permission denied"),
          "404": failure("Unknown huddle"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/members/{memberId}": {
      delete: {
        tags: ["Voice huddles"],
        summary: "Remove an invited member from a private voice huddle",
        requestParams: { path: z.object({ id: z.string(), hid: z.string(), memberId: z.string() }) },
        responses: {
          "200": reply("Success", z.object({ ok: z.boolean() })),
          "400": failure("Not a private huddle or huddle ended"),
          "401": failure("Authentication required"),
          "403": failure("Permission denied"),
          "404": failure("Unknown huddle"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/end": {
      post: {
        tags: ["Voice huddles"],
        summary: "End a voice huddle for everyone",
        requestParams: { path: z.object({ id: z.string(), hid: z.string() }) },
        responses: {
          "200": reply("Success", z.object({ ok: z.boolean() })),
          "401": failure("Authentication required"),
          "403": failure("Only the creator or admin can end this huddle"),
          "404": failure("Unknown huddle"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/segments": {
      post: {
        tags: ["Voice huddles"],
        summary: "Post caption segments for a huddle",
        requestParams: { path: z.object({ id: z.string(), hid: z.string() }) },
        requestBody: body(PostSegmentsRequest),
        responses: {
          "200": reply("Success", z.object({ ok: z.boolean() })),
          "401": failure("Authentication required"),
          "403": failure("Permission denied or huddle ended"),
          "404": failure("Unknown huddle"),
          "429": failure("Too many requests"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/focus": {
      post: {
        tags: ["Voice huddles"],
        summary: "Post member focus for a huddle",
        requestParams: { path: z.object({ id: z.string(), hid: z.string() }) },
        requestBody: body(HuddleFocusRequest),
        responses: {
          "200": reply("Success", z.object({ ok: z.boolean() })),
          "400": failure("Invalid doc or block, or huddle ended"),
          "401": failure("Authentication required"),
          "403": failure("Permission denied"),
          "404": failure("Unknown huddle"),
          "429": failure("Too many requests"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/rooms/{id}/huddles/{hid}/transcript": {
      get: {
        tags: ["Voice huddles"],
        summary: "Get transcript segments for a huddle",
        requestParams: { path: z.object({ id: z.string(), hid: z.string() }), query: HuddleTranscriptQuery },
        responses: {
          "200": reply("Transcript segments", HuddleTranscriptResponse),
          "403": failure("Permission denied"),
          "404": failure("Unknown huddle"),
          "503": failure("Voice huddles aren't set up"),
        },
      },
    },
    "/api/study/sources": {
      get: {
        tags: ["Study"],
        summary: "Documents a user can make a study set from",
        description:
          "Rooms the user created or joined (not deleted), most recently active first. With `group_id`, only " +
          "the rooms in that project of theirs.",
        security: bearer,
        requestParams: { query: StudySourcesQuery },
        responses: {
          "200": reply("The documents", StudySourcesResponse),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("Group not found"),
        },
      },
    },
    "/api/study": {
      get: {
        tags: ["Study"],
        summary: "List the user's study sets",
        description: "Newest first, up to 100, without their content.",
        security: bearer,
        responses: { "200": reply("The study sets", StudySetsResponse), ...needsVerifiedUser },
      },
      post: {
        tags: ["Study"],
        summary: "Make a quiz, flashcards, a mind map or an infographic from documents",
        description:
          "Choose the documents with `all: true` (every document, or every one in project `group_id`; the " +
          "20 most recently active) or a list of `room_ids` (up to 20, each one the user created or joined). " +
          "`count` sets the number of questions or cards (default 10); `focus` narrows the topic. Every " +
          "item carries `source_id`, the room it came from. The set is saved for the user.",
        security: bearer,
        requestBody: body(CreateStudyRequest),
        responses: {
          "201": reply("The study set", StudySet),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("A chosen document or the group was not found"),
          "409": failure("A study set for this user is already being made"),
          "422": failure("There are no documents, or the chosen ones have no text"),
          "429": {
            ...failure("A study set was made in the last 10 s"),
            headers: {
              "Retry-After": { description: "Seconds until the next study set is allowed", schema: { type: "integer" } },
            },
          },
          "502": failure("The AI service failed, timed out or returned an unexpected shape"),
          "503": failure("No AI provider is configured"),
        },
      },
    },
    "/api/study/{id}": {
      get: {
        tags: ["Study"],
        summary: "Get one of the user's study sets",
        security: bearer,
        requestParams: { path: studySetId },
        responses: {
          "200": reply("The study set", StudySet),
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("Study set not found"),
        },
      },
      delete: {
        tags: ["Study"],
        summary: "Delete one of the user's study sets",
        security: bearer,
        requestParams: { path: studySetId },
        responses: {
          "204": { description: "Deleted" },
          ...invalidInput,
          ...needsVerifiedUser,
          "404": failure("Study set not found"),
        },
      },
    },
  },
});
