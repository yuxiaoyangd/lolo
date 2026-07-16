const AGENT_TIME_ZONE = 'Asia/Shanghai';
const AGENT_UTC_OFFSET = '+08:00';

const shanghaiFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: AGENT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export function formatShanghaiDateTime(now = new Date()): string {
  const parts = Object.fromEntries(
    shanghaiFormatter
      .formatToParts(now)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  );

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${AGENT_UTC_OFFSET}`;
}

export function buildCurrentTimeContext(now = new Date()): string {
  return `时间基准（由服务器在本次请求中实时提供）：
- 当前准确时间：${formatShanghaiDateTime(now)}
- 当前时区：${AGENT_TIME_ZONE}（UTC${AGENT_UTC_OFFSET}）
- “今天、明天、后天、下午”等相对时间必须以上述时间为基准换算。
- 调用服务工具时 scheduledAt 必须使用带 +08:00 偏移的 ISO 8601 绝对时间。
- 下单前必须向用户展示换算后的完整日期和时间；如果用户的时区或时间表达不明确，先追问。`;
}
