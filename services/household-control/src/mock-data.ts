import type { ChatMessage, Conversation, FamilyProfile, PromptPreset } from "./domain.ts";

const commonCapabilities = ["chat", "voiceInput", "attachImages", "viewHouseholdStatus"] as const;

export const profiles: FamilyProfile[] = [
  {
    id: "alex",
    displayName: "Owner",
    initials: "OW",
    agentId: "main",
    role: "admin",
    color: "#3559E0",
    status: "working",
    statusDetail: "Planning the week",
    capabilities: [...commonCapabilities, "viewDiagnostics", "manageAccess"],
  },
  {
    id: "natasha",
    displayName: "Adult",
    initials: "AD",
    agentId: "natasha",
    role: "adult",
    color: "#9C4DCC",
    status: "working",
    statusDetail: "Checking the family calendar",
    capabilities: [...commonCapabilities],
  },
  {
    id: "fred",
    displayName: "Child One",
    initials: "C1",
    agentId: "fred",
    role: "child",
    color: "#E48122",
    status: "queued",
    statusDetail: "Next in line",
    capabilities: [...commonCapabilities],
  },
  {
    id: "belle",
    displayName: "Child Two",
    initials: "C2",
    agentId: "belle",
    role: "child",
    color: "#16866A",
    status: "available",
    statusDetail: "Ready",
    capabilities: [...commonCapabilities],
  },
];

export const devices = new Map<string, string>([
  ["alex-phone", "alex"],
  ["natasha-phone", "natasha"],
  ["fred-tablet", "fred"],
  ["belle-phone", "belle"],
]);

export const presets: PromptPreset[] = [
  {
    id: "ayso",
    label: "AYSO soccer",
    description: "Schedules, fields, equipment, and family soccer context.",
    allowedRoles: ["admin", "adult", "child"],
  },
  {
    id: "homework",
    label: "Homework helper",
    description: "Explain and coach without simply completing the work.",
    allowedRoles: ["admin", "adult", "child"],
  },
  {
    id: "household-planning",
    label: "Household planning",
    description: "Calendars, lists, errands, meals, and coordination.",
    allowedRoles: ["admin", "adult"],
  },
  {
    id: "story-time",
    label: "Story time",
    description: "Age-appropriate, spoken-friendly creative stories.",
    allowedRoles: ["admin", "adult", "child"],
  },
];

export const conversations: Conversation[] = [
  {
    id: "conv-alex-week",
    ownerProfileId: "alex",
    agentId: "main",
    sessionKey: "hardy-home:conv-alex-week",
    title: "This week's schedule",
    presetId: "household-planning",
    audience: "private",
    updatedAt: "2026-10-05T09:42:00-04:00",
  },
  {
    id: "conv-alex-ayso",
    ownerProfileId: "alex",
    agentId: "main",
    sessionKey: "hardy-home:conv-alex-ayso",
    title: "AYSO weekend",
    presetId: "ayso",
    audience: "household",
    updatedAt: "2026-10-04T18:15:00-04:00",
  },
  {
    id: "conv-fred-homework",
    ownerProfileId: "fred",
    agentId: "fred",
    sessionKey: "hardy-home:conv-fred-homework",
    title: "Math homework",
    presetId: "homework",
    audience: "private",
    updatedAt: "2026-10-05T08:10:00-04:00",
  },
];

export const messages: ChatMessage[] = [
  {
    id: "msg-1",
    conversationId: "conv-alex-week",
    role: "user",
    text: "What does the family schedule look like after school today?",
    createdAt: "2026-10-05T09:41:00-04:00",
  },
  {
    id: "msg-2",
    conversationId: "conv-alex-week",
    role: "assistant",
    text: "There are two items to coordinate: soccer practice at 5:30 and the grocery pickup window beginning at 6:00. I can help work out the handoff.",
    createdAt: "2026-10-05T09:42:00-04:00",
  },
  {
    id: "msg-3",
    conversationId: "conv-alex-ayso",
    role: "assistant",
    text: "AYSO mode is ready. I will keep field locations, uniforms, snacks, and schedule conflicts in view.",
    createdAt: "2026-10-04T18:15:00-04:00",
  },
  {
    id: "msg-4",
    conversationId: "conv-fred-homework",
    role: "assistant",
    text: "Let's solve it together one step at a time. What part feels confusing?",
    createdAt: "2026-10-05T08:10:00-04:00",
  },
];
