const LINK_PREVIEW_BOT_USER_AGENT_RE =
  /\b(slackbot|twitterbot|facebookexternalhit|facebot|linkedinbot|discordbot|whatsapp|telegrambot|skypeuripreview|microsoftpreview|teamsbot|pinterest|redditbot|applebot)\b/i;

export function isLinkPreviewBotUserAgent(userAgent: string | null | undefined) {
  return LINK_PREVIEW_BOT_USER_AGENT_RE.test(userAgent ?? "");
}
