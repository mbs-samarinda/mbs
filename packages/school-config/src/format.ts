// The schools are in Samarinda, so every date and time is theirs, wherever the
// reader's device or the server is.
export const TIME_ZONE = "Asia/Makassar";

const dayAndMonth = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
});
const date = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});
const time = new Intl.DateTimeFormat("id-ID", {
  timeZone: TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const formatDayAndMonth = (iso: string) => dayAndMonth.format(new Date(iso));
export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatTime = (iso: string) => `${time.format(new Date(iso))} WITA`;
export const formatDateTime = (iso: string) => `${formatDate(iso)}, ${formatTime(iso)}`;
